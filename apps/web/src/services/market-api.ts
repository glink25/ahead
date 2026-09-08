import type { ContentProvider, MarketProvider } from './providers'
import { ResourceQuery } from './resource-query'
import { parseLocator, sourceKey } from '@ahead/protocol'
import {
  createValidator,
  type Subscription,
  type UserData,
} from '@ahead/schema'
import {
  assertEventFeed,
  type LoadedFeed,
} from '../lib/feed-loader'
import type { MarketListing } from './providers'
import { ResourceCache } from '../lib/resource-cache'
import type { LocalStore } from '../data/storage'
import type { Space } from '@ahead/sync'
import { workspaceRecords } from '@ahead/sync'
import { resolve as resolveProfile, selectCurrentSchedule, type ResolvedEvent, type ResolvedProfile } from '@ahead/resolver'
import {
  isAbort,
  PublicReadError,
} from './public-read-client'
import { database, useData } from '../data/local'
import { eventFeed, materializeProfile, personalEvents } from '../data/model'
import { primaryFeedForEvent } from '../lib/primary-feed'
import {
  addressFromSourceKey,
  addressFromTarget,
  addressKey,
  remoteAddress,
  localEventAddress,
  localFeedAddress,
  localUserAddress,
  sourceFromAddress,
  type ResourceAddress,
} from './resource-address'

type Source = Pick<Subscription, 'locator' | 'manifestPath' | 'kind'>
export type ResourceVisibility = 'local' | 'public' | 'private'
export type AddressedEvent = ResolvedEvent & { address: ResourceAddress }
export interface WorkspaceInfo { spaceId: string; status: Space['status']; pending: number; editable: boolean }
export type ReadEvent =
  | { type: 'feed'; feed: LoadedFeed; address: ResourceAddress; eventAddresses: Record<string, ResourceAddress>; visibility: ResourceVisibility; cached: boolean; workspace?: WorkspaceInfo }
  | { type: 'user'; user: UserData; sourceLocator: string; address: ResourceAddress; visibility: ResourceVisibility; cached: boolean; workspace?: WorkspaceInfo }
  | {
      type: 'error'
      message: string
      limited: boolean
      authenticated?: boolean
      reason?: 'auth' | 'missing' | 'unavailable' | 'local-missing'
    }
export type MarketEvent =
  | ReadEvent
  | { type: 'listings'; listings: MarketListing[]; cached: boolean; replace?: boolean }
  | { type: 'progress'; cursor: string; loaded: number; complete: boolean }
export type DiscoverMarketStatus = 'idle' | 'restoring' | 'expanding' | 'paused' | 'complete' | 'failed'
export interface DiscoverMarketSession {
  setActive(active: boolean): void
  reportVisible(index: number, available: number): void
  refresh(): Promise<void>
  retry(): Promise<void>
  close(): void
}
interface Session {
  page: string
  nextPage?: string
  entries?: MarketListing[]
  done: Set<string>
  listings: Map<string, MarketListing>
  refresh: boolean
  loaded: number
  complete: boolean
}
const validator = createValidator()

/** Browser-side business API. GitHub, storage and scheduling stay behind this boundary. */
export class MarketApi {
  private closed = false
  close() { this.closed = true; this.listeners.clear(); this.queries.forEach((query) => query.close()) }
  revalidate(force = false) { this.queries.forEach((query) => query.revalidate(force)) }
  workspaceFeed(source: string): LoadedFeed | undefined {
    const db = useData.getState().db
    const space = Object.values(db?.spaces ?? {}).find((space) =>
      (!space.account || space.account === this.options.account) && space.feed &&
      sourceKey({ locator: space.feed.locator, manifestPath: space.feed.path }) === source,
    )
    return space ? { sourceLocator: source, manifestPath: space.feed!.path, feed: eventFeed(space), version: space.feed!.version, complete: true } : undefined
  }
  private queries = new Map<string, ResourceQuery>()
  private listeners = new Set<(event: ReadEvent) => void>()
  subscribe(listener: (event: ReadEvent) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  invalidateWorkspace() {
    for (const [key, query] of this.queries) if (key.includes('workspace:') || query.snapshot().resource?.workspace) query.invalidate()
  }
  invalidateSource(source: string) {
    for (const [key, query] of this.queries) if (key.includes(JSON.stringify(source).slice(1, -1))) {
      query.invalidate()
      if (this.listeners.size) void query.read()
    }
  }
  query(options: { address: ResourceAddress; kind: 'event-feed' | 'user-data'; eventId?: string }) {
    const db = useData.getState().db
    const local = Object.values(db?.spaces ?? {}).find((space) => {
      if (space.account && space.account !== this.options.account) return false
      if (options.address.scheme === 'local') return space.id === options.address.spaceId
      const target = options.kind === 'event-feed' ? space.feed : space.remote
      return target && addressKey(addressFromTarget(target)) === addressKey(options.address)
    })
    const key = JSON.stringify([options.kind, local ? `workspace:${local.id}` : addressKey(options.address), options.eventId ?? ''])
    let query = this.queries.get(key)
    if (!query) {
      query = new ResourceQuery((signal, refresh) => this.openResource({ ...options, signal, refresh }), (event) => { if (!this.closed) this.listeners.forEach((listener) => listener(event)) })
      this.queries.set(key, query)
      for (const [oldKey, old] of this.queries) {
        if (this.queries.size <= 200) break
        if (oldKey !== key && !old.active) { old.close(); this.queries.delete(oldKey) }
      }
    }
    return query
  }
  private sessions = new Map<string, Session>()
  readonly market = {
    snapshot: async () => {
      const listings = await this.options.storage
        .get<MarketListing[]>('market:' + this.options.marketProvider.id)
        .catch(() => undefined)
      return listings?.slice(-60)
    },
    stream: (
      options: {
        cursor?: string
        refresh?: boolean
        signal?: AbortSignal
        maxPages?: number
      } = {},
    ) => this.stream(options),
    restore: (options: { limit?: number; signal?: AbortSignal } = {}) =>
      this.restoreMarket(options.limit ?? 40, options.signal),
    probeHead: (options: { signal?: AbortSignal } = {}) =>
      this.probeMarketHead(options.signal),
    openSession: (options: {
      receive: (event: MarketEvent) => void
      status: (status: DiscoverMarketStatus) => void
      available: () => number
    }) => this.openDiscoverSession(options),
  }
  readonly sources = {
    snapshot: (sources: Source[]) =>
      this.readSources(sources, { cachedOnly: true }),
    read: (options: {
      sources: Source[]
      refresh?: boolean
      signal?: AbortSignal
    }) => this.readSources(options.sources, options),
    open: (options: {
      address: ResourceAddress
      kind: 'event-feed' | 'user-data'
      eventId?: string
      refresh?: boolean
      signal?: AbortSignal
    }) => this.query(options).stream(options.refresh, options.signal),
  }
  readonly events = {
    resolve: (options: {
      feeds: LoadedFeed[]
      users: { user: UserData; sourceLocator: string }[]
      activeProfile: UserData
      space?: Space
      locale?: string
      timezone?: string
      now?: Date | string
    }) => this.resolveEvents(options),
  }
  constructor(
    private options: {
      account?: string
      storage: LocalStore
      cache: ResourceCache
      content: ContentProvider[]
      marketProvider: MarketProvider
    },
  ) {}

  private error(error: unknown, prefix: string): ReadEvent & { type: 'error' } {
    const explicitStatus = (error as { status?: unknown })?.status
    const status = error instanceof PublicReadError
      ? error.status
      : typeof explicitStatus === 'number'
        ? explicitStatus
        : Number(/HTTP (\d{3})/u.exec(String(error))?.[1]) || undefined
    return {
      type: 'error',
      message: `${prefix}：${String(error)}`,
      limited: error instanceof PublicReadError && error.limited,
      authenticated:
        error instanceof PublicReadError ? error.authenticated : undefined,
      reason: status === 401 || status === 403
        ? 'auth'
        : status === 404
          ? 'missing'
          : 'unavailable',
    }
  }

  private resolveEvents(options: {
    feeds: LoadedFeed[]
    users: { user: UserData; sourceLocator: string }[]
    activeProfile: UserData
    space?: Space
    locale?: string
    timezone?: string
    now?: Date | string
  }): Omit<ResolvedProfile, 'events'> & { events: AddressedEvent[] } {
    const resolved = resolveProfile({
      ...options,
      feeds: options.feeds.map((feed) => this.workspaceFeed(feed.sourceLocator) ?? feed),
      users: [options.activeProfile, ...options.users],
    })
    const remote = resolved.events.flatMap((event) => {
      const feed = primaryFeedForEvent(event, options.feeds)
      return feed ? [{ ...event, address: addressFromSourceKey(feed.sourceLocator) }] : []
    })
    if (!options.space) return { ...resolved, events: remote }
    const now = new Date(options.now ?? new Date())
    const own = personalEvents(workspaceRecords(options.space)).map((event) => ({
      ...event,
      currentSchedule: selectCurrentSchedule(event.schedule, now),
      sourceLocators: [`local:${options.space!.id}`],
      provenance: [],
      address: localEventAddress(options.space!, event.id),
    }))
    const ownIds = new Set(own.map((event) => event.id))
    return { ...resolved, events: [...remote.filter((event) => !ownIds.has(event.id)), ...own] }
  }

  private async *openResource(options: {
    address: ResourceAddress
    kind: 'event-feed' | 'user-data'
    eventId?: string
    refresh?: boolean
    signal?: AbortSignal
  }): AsyncGenerator<ReadEvent> {
    const db = await database.query()
    const local = Object.values(db.spaces).find((space) => {
      if (space.account && space.account !== this.options.account) return false
      if (options.address.scheme === 'local') return space.id === options.address.spaceId
      const target = options.kind === 'event-feed' ? space.feed : space.remote
      return target && addressKey(addressFromTarget(target)) === addressKey(options.address)
    })
    if (local) {
      const address = options.kind === 'user-data' ? localUserAddress(local)
        : options.eventId ? localEventAddress(local, options.eventId) : localFeedAddress(local)
      const target = options.kind === 'event-feed' ? local.feed : local.remote
      const sourceLocator = target ? sourceKey({ locator: target.locator, manifestPath: target.path }) : `local:${local.id}`
      const visibility = address.scheme === 'local' ? 'local' : target?.private ? 'private' : 'public'
      const workspace = { spaceId: local.id, status: local.status, pending: local.syncProvider ? Object.keys(local.patches).length : 0, editable: local.id === db.active }
      if (options.kind === 'event-feed') {
        const feed = eventFeed(local)
        yield { type: 'feed', feed: { sourceLocator, manifestPath: target?.path ?? 'ahead.yaml', feed, version: target?.version },
          address, eventAddresses: Object.fromEntries((feed.events ?? []).map((event) => [event.id, localEventAddress(local, event.id)])),
          visibility, cached: true, workspace }
      } else {
        yield { type: 'user', user: materializeProfile(workspaceRecords(local)), sourceLocator, address, visibility, cached: true, workspace }
      }
      return
    }
    if (options.address.scheme === 'local') {
      yield { type: 'error', message: 'messages.local_resource_belongs_to_another_device', reason: 'local-missing', limited: false }
      return
    }
    yield* this.readOne(sourceFromAddress(options.address, options.kind), { signal: options.signal, privateAccess: true, refresh: options.refresh, eventId: options.eventId })
  }

  /** Favorites store event IDs; resolve their source association from local content only. */
  async relatedSources(profile: UserData): Promise<Source[]> {
    const sources = new Map<string, Source>()
    for (const source of profile.subscriptions ?? [])
      sources.set(sourceKey(source), source)
    const ids = new Set([...(profile.favorites ?? []), ...(profile.pins ?? [])])
    if (ids.size) for (const source of await this.options.cache.relatedSources(ids)) sources.set(sourceKey(source), source)
    return [...sources.values()]
  }

  private async *readOne(
    source: Source,
    options: {
      signal?: AbortSignal
      cachedOnly?: boolean
      privateAccess?: boolean
      refresh?: boolean
      eventId?: string
    } = {},
  ): AsyncGenerator<ReadEvent> {
    const { signal, cachedOnly = false } = options
    const key = sourceKey(source), path = source.manifestPath ?? 'ahead.yaml'
    try {
      const user = source.kind === 'user-data'
      const feedCache = user ? undefined : await this.options.cache.readAny(key, path, options.eventId)
      const userCache = user ? await this.options.cache.readUserSnapshot(key) : undefined
      let document = user ? userCache?.value : feedCache?.feed
      const complete = user || feedCache?.complete !== false
      const usable = complete || cachedOnly || Boolean(options.eventId && feedCache?.feed.events?.some((event) => event.id === options.eventId))
      const emit = (value: UserData | import('@ahead/schema').EventFeed, privateResource: boolean, cached: boolean): ReadEvent => value.kind === 'user-data'
        ? { type: 'user', user: value, sourceLocator: key, address: remoteAddress(source), visibility: privateResource ? 'private' : 'public', cached }
        : { type: 'feed', feed: { sourceLocator: key, manifestPath: path, feed: value, complete, version: feedCache?.version }, address: remoteAddress(source), eventAddresses: Object.fromEntries((value.events ?? []).map((event) => [event.id, remoteAddress(source)])), visibility: privateResource ? 'private' : 'public', cached }
      if (document && !validator.validate(user ? 'user-data' : 'event-feed', document).ok) throw new Error('messages.profile_validation_failed')
      if (document && usable) yield emit(document, Boolean(userCache?.private ?? feedCache?.private), true)
      if (signal?.aborted || cachedOnly) return
      const checked = userCache?.storedAt ?? feedCache?.storedAt
      if (document && usable && !options.refresh && checked && Date.now() - Date.parse(checked) < 300_000) return
      if (!navigator.onLine && document && usable) return
      const scheme = parseLocator(source.locator).scheme
      const provider = this.options.content.find((item) => item.scheme === scheme)
      if (!provider) throw new Error('Unsupported content provider: ' + scheme)
      const result = await provider.read(source, { version: complete ? userCache?.version ?? feedCache?.version : undefined, signal, refresh: options.refresh })
      if (signal?.aborted) return
      document = result.document ?? document
      if (!document) throw new Error('messages.could_not_read_the_market')
      if (document.kind === 'user-data') await this.options.cache.writeUser(key, document, result.private, result.version)
      else await this.options.cache.write({ sourceLocator: key, manifestPath: path, feed: document, version: result.version, private: result.private, complete: true })
      const event = emit(document, result.private, false)
      if (event.type === 'feed') { event.feed.version = result.version; event.feed.complete = true }
      yield event
    } catch (error) {
      if (!isAbort(error) && !signal?.aborted) yield this.error(error, 'messages.update_failed_available_content_was_preserved')
    }
  }

  private async *readSources(
    sources: Source[],
    options: { refresh?: boolean; signal?: AbortSignal; cachedOnly?: boolean },
  ): AsyncGenerator<ReadEvent> {
    for (const source of new Map(
      sources.map((source) => [sourceKey(source), source]),
    ).values()) {
      if (options.signal?.aborted) return
      const stream = options.cachedOnly
        ? this.readOne(source, { signal: options.signal, cachedOnly: true })
        : this.query({ address: remoteAddress(source), kind: source.kind ?? 'event-feed' }).stream(options.refresh, options.signal)
      for await (const event of stream) {
        yield event
        if (event.type === 'error' && event.limited) return
      }
    }
  }

  private async *stream(options: {
    cursor?: string
    refresh?: boolean
    signal?: AbortSignal
    maxPages?: number
  }): AsyncGenerator<MarketEvent> {
    const cursor = options.cursor ?? crypto.randomUUID()
    let session = this.sessions.get(cursor)
    if (!session) {
      if (options.cursor) throw new Error('messages.the_market_session_expired_please_refresh')
      session = {
        page: '',
        done: new Set(),
        listings: new Map(),
        loaded: 0,
        complete: false,
        refresh: Boolean(options.refresh),
      }
      this.sessions.clear()
      this.sessions.set(cursor, session)
    }
    const state = session
    const progress = (): MarketEvent => ({
      type: 'progress',
      cursor,
      loaded: state.loaded,
      complete: state.complete,
    })
    yield progress()
    if (!state.entries && state.page === '' && !state.listings.size) {
      const cached = await this.options.storage
        .get<MarketListing[]>('market:' + this.options.marketProvider.id)
        .catch(() => undefined)
      if (cached?.length) {
        yield { type: 'listings', listings: cached, cached: true }
        // Warm only the first batch; never scan/download the entire market before showing it.
        for (const listing of cached.slice(0, 20)) {
          if (options.signal?.aborted) return
          if (listing.source.resourceType !== 'event-feed') continue
                    const feed = await this.options.cache.readAny(
            sourceKey(listing.source),
            listing.source.manifestPath ?? 'ahead.yaml',
          )
          if (feed) {
            try {
              assertEventFeed(feed.feed, validator, sourceKey(listing.source))
            } catch {
              continue
            }
            yield {
              type: 'feed',
              feed: { ...feed },
              address: remoteAddress(listing.source),
              eventAddresses: Object.fromEntries(
                (feed.feed.events ?? []).map((event) => [event.id, remoteAddress(listing.source)]),
              ),
              visibility: feed.private ? 'private' : 'public',
              cached: true,
            }
          }
        }
      }
    }
    let pagesRead = 0
    while (!state.complete && !options.signal?.aborted) {
      if (!state.entries) {
        try {
          const page = await this.options.marketProvider.list({ cursor: state.page || undefined, signal: options.signal, refresh: state.refresh })
          if (options.signal?.aborted) return
          state.entries = page.listings.filter(
            (listing) => !state.listings.has(sourceKey(listing.source)),
          )
          state.nextPage = page.cursor
          pagesRead++
          for (const listing of state.entries)
            state.listings.set(sourceKey(listing.source), listing)
          yield {
            type: 'listings',
            listings: [...state.listings.values()],
            cached: false,
          }
          await this.options.storage
            .update<MarketListing[]>(
              'market:' + this.options.marketProvider.id,
              (old) => [
                ...new Map(
                  [...(old ?? []), ...state.listings.values()].map((item) => [
                    sourceKey(item.source),
                    item,
                  ]),
                ).values(),
              ].slice(-60),
            )
            .catch(() => {})
        } catch (error) {
          if (!isAbort(error) && !options.signal?.aborted) {
            yield this.error(error, 'messages.could_not_read_the_market')
            yield progress()
          }
          return
        }
      } else
        yield {
          type: 'listings',
          listings: [...state.listings.values()],
          cached: false,
        }
      const entries = state.entries.filter(
        (item) =>
          item.source.resourceType === 'event-feed' &&
          !state.done.has(sourceKey(item.source)),
      )
      const running = new Map<
        string,
        {
          iterator: AsyncGenerator<ReadEvent>
          next: Promise<{ key: string; value: IteratorResult<ReadEvent> }>
        }
      >()
      let position = 0
      const next = (key: string, iterator: AsyncGenerator<ReadEvent>) =>
        iterator.next().then((value) => ({ key, value }))
      try {
        while (
          (position < entries.length || running.size) &&
          !options.signal?.aborted
        ) {
          while (
            running.size < 3 &&
            position < entries.length &&
            !options.signal?.aborted
          ) {
            const listing = entries[position++]!,
              key = sourceKey(listing.source)
            const iterator = this.query({ address: remoteAddress(listing.source), kind: 'event-feed' }).stream(state.refresh, options.signal)
            running.set(key, { iterator, next: next(key, iterator) })
          }
          if (!running.size) break
          const result = await Promise.race(
            [...running.values()].map((item) => item.next),
          )
          if (options.signal?.aborted) return
          const worker = running.get(result.key)!
          if (result.value.done) {
            state.done.add(result.key)
            state.loaded++
            running.delete(result.key)
            yield progress()
          } else {
            yield result.value.value
            if (
              result.value.value.type === 'error' &&
              result.value.value.limited
            )
              return
            worker.next = next(result.key, worker.iterator)
          }
        }
      } finally {
        // A generator return is queued behind its pending next; always observe both promises.
        await Promise.all(
          [...running.values()].map(async (worker) => {
            await worker.next.catch(() => {})
            await worker.iterator.return(undefined).catch(() => {})
          }),
        )
      }
      if (options.signal?.aborted) return
      if (state.nextPage) {
        state.page = state.nextPage
        state.entries = undefined
        yield progress()
        if (options.maxPages !== undefined && pagesRead >= options.maxPages) return
      } else {
        state.complete = true
        const listings = [...state.listings.values()].slice(0, 60)
        await this.options.storage.set('market:' + this.options.marketProvider.id, listings)
        yield { type: 'listings', listings, cached: false, replace: true }
        yield progress()
      }
    }
  }

  private async *restoreMarket(limit: number, signal?: AbortSignal): AsyncGenerator<MarketEvent> {
    const cached = await this.options.storage
      .get<MarketListing[]>('market:' + this.options.marketProvider.id)
      .catch(() => undefined)
    if (!cached?.length || signal?.aborted) return
    const window = cached.slice(-limit)
    yield { type: 'listings', listings: window, cached: true }
    for (const listing of window) {
      if (signal?.aborted) return
      if (listing.source.resourceType !== 'event-feed') continue
            const feed = await this.options.cache.readAny(
        sourceKey(listing.source),
        listing.source.manifestPath ?? 'ahead.yaml',
      )
      if (!feed) continue
      try {
        assertEventFeed(feed.feed, validator, sourceKey(listing.source))
      } catch {
        continue
      }
      yield {
        type: 'feed',
        feed: { ...feed },
        address: remoteAddress(listing.source),
        eventAddresses: Object.fromEntries(
          (feed.feed.events ?? []).map((event) => [event.id, remoteAddress(listing.source)]),
        ),
        visibility: feed.private ? 'private' : 'public',
        cached: true,
      }
    }
  }

  private async probeMarketHead(signal?: AbortSignal): Promise<MarketListing[] | undefined> {
    const stateKey = 'market-probe:' + this.options.marketProvider.id
    const previous = await this.options.storage.get<{ checkedAt: number }>(stateKey).catch(() => undefined)
    if (previous && Date.now() - previous.checkedAt < 6 * 60 * 60_000) return undefined
    const result = await this.options.marketProvider.list({ signal })
    if (signal?.aborted) return undefined
    const key = 'market:' + this.options.marketProvider.id
    const merged = await this.options.storage.update<MarketListing[]>(key, (old) => {
      const incoming = new Set(result.listings.map((item) => sourceKey(item.source)))
      return [
        ...(old ?? []).filter((item) => !incoming.has(sourceKey(item.source))),
        ...result.listings,
      ].slice(-60)
    }).catch(() => result.listings)
    await this.options.storage.set(stateKey, { checkedAt: Date.now() }).catch(() => {})
    return merged.slice(-40)
  }

  /**
   * Owns all demand thresholds and paging for one Discover browsing session.
   * Callers report viewport progress; they never handle Market cursors or pages.
   */
  private openDiscoverSession(options: {
    receive: (event: MarketEvent) => void
    status: (status: DiscoverMarketStatus) => void
    available: () => number
  }): DiscoverMarketSession {
    let active = false
    let started = false
    let running: Promise<void> | undefined
    let controller: AbortController | undefined
    let cursor: string | undefined
    let lastExpansionIndex = 0
    let failed = false
    let finished = false
    let pendingDemand = false

    const consume = async (refresh = false) => {
      if (!active || running) return running
      controller = new AbortController()
      const current = controller
      let completed = false
      let hadError = false
      options.status(started ? 'expanding' : 'restoring')
      running = (async () => {
        try {
          for await (const event of this.market.stream({
            cursor,
            refresh,
            signal: current.signal,
            maxPages: 1,
          })) {
            if (current.signal.aborted) return
            if (event.type === 'progress') {
              cursor = event.cursor
              completed ||= event.complete
            }
            if (event.type === 'error') hadError = true
            options.receive(event)
          }
          failed = hadError
          finished = completed
          options.status(hadError ? 'failed' : completed ? 'complete' : 'paused')
        } catch (error) {
          if (!isAbort(error)) {
            failed = true
            options.receive(this.error(error, 'messages.could_not_read_the_market'))
            options.status('failed')
          }
        } finally {
          if (controller === current) controller = undefined
          running = undefined
          if (pendingDemand && active && !failed && !finished) {
            pendingDemand = false
            queueMicrotask(() => { void consume(false) })
          }
        }
      })()
      return running
    }

    const start = async () => {
      if (started || !active) return
      started = true
      controller = new AbortController()
      const current = controller
      options.status('restoring')
      for await (const event of this.market.restore({ limit: 40, signal: current.signal }))
        if (!current.signal.aborted) options.receive(event)
      // Let the recommendation consumer publish the usable candidate count.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (controller === current) controller = undefined
      // Only an empty local candidate set is allowed to request the first page.
      if (options.available() > 0 || current.signal.aborted) {
        options.status('paused')
        if (!current.signal.aborted) void this.market.probeHead().then((listings) => {
          if (listings?.length && active) options.receive({ type: 'listings', listings, cached: false })
        }).catch(() => {})
        return
      }
      await consume(false)
    }

    return {
      setActive(value) {
        active = value
        if (!active) {
          controller?.abort()
          options.status('paused')
        } else if (!started) void start()
        else if (pendingDemand && !running && !finished) {
          pendingDemand = false
          void consume(false)
        }
        else if (!running && !finished && options.available() === 0) void consume(false)
      },
      reportVisible(index, available) {
        if (!active || failed || finished) return
        const remaining = Math.max(0, available - index - 1)
        const consumedEnough = index - lastExpansionIndex >= 10
        const criticallyShort = available < 8
        if ((consumedEnough || criticallyShort) && remaining < 8) {
          lastExpansionIndex = index
          if (running) {
            pendingDemand = true
            return
          }
          void consume(false)
        }
      },
      async refresh() {
        active = true
        started = true
        cursor = undefined
        lastExpansionIndex = 0
        failed = false
        finished = false
        controller?.abort()
        await running?.catch(() => {})
        await consume(true)
      },
      async retry() {
        failed = false
        finished = false
        await consume(false)
      },
      close() {
        active = false
        controller?.abort()
        options.status('idle')
      },
    }
  }
}
