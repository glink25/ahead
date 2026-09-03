import type { EventFeed, UserData } from '@ahead/schema'
import { ResourceGraph } from './graph.js'
import { mergeEvents } from './merge.js'
import { applyPatches } from './patch.js'
import { selectCurrentSchedule } from './schedule.js'
import type {
  FeedResource,
  ProvenancedEvent,
  ResolvedProfile,
  UserResource,
} from './types.js'

export interface ResolveOptions {
  feeds: readonly FeedResource[]
  users: readonly UserResource[]
  activeProfile: string | UserData
  locale?: string
  timezone?: string
  now?: Date | string
}

function feedResource(input: FeedResource): {
  feed: EventFeed
  sourceLocator: string
  priority: number
} {
  if ('kind' in input) return { feed: input, sourceLocator: input.id, priority: 0 }
  if ('feed' in input) {
    return { feed: input.feed, sourceLocator: input.sourceLocator, priority: input.priority ?? 0 }
  }
  return { feed: input.resource, sourceLocator: input.sourceLocator, priority: input.priority ?? 0 }
}

function userResource(input: UserResource): { user: UserData; sourceLocator: string } {
  if ('kind' in input) return { user: input, sourceLocator: input.id }
  if ('user' in input) return { user: input.user, sourceLocator: input.sourceLocator }
  return { user: input.resource, sourceLocator: input.sourceLocator }
}

export function resolve(options: ResolveOptions): ResolvedProfile {
  const now = new Date(options.now ?? new Date())
  if (!Number.isFinite(now.getTime())) throw new RangeError('resolve requires a valid now value')

  const feeds = options.feeds.map(feedResource)
  const users = options.users.map(userResource)
  const active =
    typeof options.activeProfile === 'string'
      ? users.find(
          ({ user, sourceLocator }) =>
            user.id === options.activeProfile || sourceLocator === options.activeProfile,
        )?.user
      : options.activeProfile
  if (!active) throw new Error(`Active profile not found: ${String(options.activeProfile)}`)

  const graph = new ResourceGraph()
  for (const { sourceLocator } of feeds) graph.addResource(sourceLocator, 'feed')
  for (const { sourceLocator, user } of users) {
    graph.addResource(sourceLocator, 'user')
    for (const subscription of user.subscriptions ?? []) {
      graph.addEdge(sourceLocator, subscription.locator, subscription.kind ?? 'event-feed')
    }
  }
  graph.assertNoFeedEdges()
  const cycles = graph.detectCycles()
  if (cycles.length > 0) throw new Error(`Resource subscription cycle: ${cycles[0]!.join(' -> ')}`)

  const subscriptionPriorities = Object.fromEntries(
    (active.subscriptions ?? []).map((subscription) => [
      subscription.locator,
      subscription.priority ?? 0,
    ]),
  )
  const inputs: ProvenancedEvent[] = feeds.flatMap(({ feed, sourceLocator, priority }) =>
    (feed.events ?? []).map((event) => ({
      event,
      sourceLocator,
      priority: subscriptionPriorities[sourceLocator] ?? priority,
    })),
  )
  const patches = active.patches ?? []
  const events = mergeEvents(inputs).map((event) => {
    const patched = applyPatches(event, patches)
    return {
      ...event,
      ...patched,
      currentSchedule: selectCurrentSchedule(patched.schedule, now),
      provenance: [
        ...event.provenance,
        ...patches
          .filter((patch) => patch.eventId === event.id)
          .flatMap((patch) =>
            patch.ops.map((operation) => ({
              field: operation.path,
              sourceLocator: active.id,
              reason: 'overridden' as const,
            })),
          ),
      ],
    }
  })

  const remoteFavorites: Record<string, number> = {}
  for (const { user } of users) {
    if (user.id === active.id) continue
    for (const id of new Set(user.favorites ?? [])) {
      remoteFavorites[id] = (remoteFavorites[id] ?? 0) + 1
    }
  }

  return {
    id: active.id,
    profile: structuredClone(active),
    events,
    locale: options.locale ?? active.settings?.locale ?? 'en',
    timezone: options.timezone ?? active.settings?.timezone ?? 'UTC',
    now: now.toISOString(),
    favorites: [...new Set(active.favorites ?? [])].sort(),
    remoteFavorites,
    hidden: [...new Set(active.hidden ?? [])].sort(),
    pins: [...new Set(active.pins ?? [])].sort(),
    interests: { ...(active.interests ?? {}) },
    subscriptionPriorities,
  }
}
