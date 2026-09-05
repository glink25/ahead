import type { RepositoryAdapter, ResourceLocator } from '@ahead/core'
import { parseLocator, parseYaml, sourceKey, manifestPath as safePath } from '@ahead/protocol'
import { createValidator, type EventFeed, type Event, type OefValidator } from '@ahead/schema'
import type { MarketListing } from './market'
import { RepoCache } from './repo-cache'
import { assertDurationFitsRecurrence } from '@ahead/resolver'

const DEFAULT_MANIFEST_PATH = 'ahead.yaml'
const DEFAULT_EVENTS_GLOB = 'events/**/*.yaml'

/** A feed that is ready to hand to `resolve()`. */
export interface LoadedFeed {
  /** Serialized locator, used as the resolver's source locator. */
  sourceLocator: string
  manifestPath: string
  feed: EventFeed
  /**
   * Commit the content was read at. Absent for market-inlined manifests, which
   * are not pinned to a commit; media falls back to a branch URL in that case.
   */
  headSha?: string
  locator: ResourceLocator
}

export class FeedLoadError extends Error {
  constructor(
    message: string,
    readonly sourceLocator: string,
  ) {
    super(message)
    this.name = 'FeedLoadError'
  }
}

function githubLocator(locator: string): ResourceLocator {
  const parsed = parseLocator(locator)
  if (parsed.scheme !== 'github' || !('owner' in parsed)) {
    throw new FeedLoadError(`Unsupported locator: ${locator}`, locator)
  }
  return parsed
}

export function assertEventFeed(
  document: unknown,
  validator: OefValidator,
  sourceLocator: string,
): EventFeed {
  const result = validator.validate('event-feed', document)
  if (!result.ok) {
    const detail =
      result.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('；') ??
      'messages.schema_validation_failed'
    throw new FeedLoadError(detail, sourceLocator)
  }
  const feed = document as EventFeed
  for (const event of feed.events ?? []) assertDurationFitsRecurrence(event.duration, event.recurrence)
  return feed
}

/** Matches a glob such as `events/**\/*.yaml` against repository tree paths. */
export function globToRegExp(glob: string): RegExp {
  let pattern = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!
    if (char === '*') {
      if (glob[index + 1] === '*') {
        // `**/` spans directories, and also matches zero directories.
        if (glob[index + 2] === '/') {
          pattern += '(?:[^/]+/)*'
          index += 2
        } else {
          pattern += '.*'
          index += 1
        }
      } else {
        pattern += '[^/]*'
      }
      continue
    }
    pattern += char.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(`^${pattern}$`, 'u')
}

export function matchesEventsGlob(path: string, glob = DEFAULT_EVENTS_GLOB): boolean {
  return globToRegExp(glob).test(path)
}

/**
 * Expands `eventsGlob` into inline events.
 *
 * `resolve()` only reads `feed.events`, so a manifest that points at separate
 * event files has to be flattened here or its events silently disappear.
 */
async function expandEventsGlob(
  feed: EventFeed,
  locator: ResourceLocator,
  ref: string,
  adapter: RepositoryAdapter,
  validator: OefValidator,
  sourceLocator: string,
): Promise<EventFeed> {
  const glob = feed.eventsGlob ?? DEFAULT_EVENTS_GLOB
  const matcher = globToRegExp(glob)
  const tree = await adapter.readTree(locator, ref)
  const paths = tree
    .filter((entry) => entry.type === 'blob' && matcher.test(entry.path))
    .map((entry) => entry.path)
    .sort()

  const events: Event[] = [...(feed.events ?? [])]
  for (const path of paths) {
    const file = await adapter.readFile(locator, path, { ref })
    const document = parseYaml<unknown>(file.content)
    const result = validator.validate('event', document)
    if (!result.ok) {
      const detail =
        result.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('；') ??
        'messages.schema_validation_failed'
      throw new FeedLoadError(`${path}：${detail}`, sourceLocator)
    }
    const event = document as Event
    assertDurationFitsRecurrence(event.duration, event.recurrence)
    events.push(event)
  }
  return { ...feed, events }
}

/**
 * Reads a feed straight from the market Issue body.
 *
 * Legacy migration fallback only. New listings carry metadata, not events.
 */
export function loadFeedFromListing(
  listing: MarketListing,
  validator: OefValidator = createValidator(),
): LoadedFeed | null {
  if (listing.source.resourceType !== 'event-feed' || !listing.manifest) return null
  const sourceLocator = sourceKey(listing.source)
  const manifestPath = safePath(listing.source.manifestPath)
  const feed = assertEventFeed(parseYaml<unknown>(listing.manifest), validator, sourceLocator)
  return {
    sourceLocator,
    manifestPath,
    feed,
    locator: githubLocator(listing.source.locator),
  }
}

export interface FetchFeedOptions {
  locator: string
  manifestPath?: string
  adapter: RepositoryAdapter
  validator?: OefValidator
  ref?: string
  cache?: RepoCache
  /** Authenticated, non-persistent reads may opt into private repositories. */
  allowPrivate?: boolean
}

/**
 * Reads a feed from the repository and pins it to a commit.
 *
 * Shared by discovery and subscriptions. Media uses the same immutable commit.
 */
export async function fetchFeed(options: FetchFeedOptions): Promise<LoadedFeed> {
  const validator = options.validator ?? createValidator()
  const sourceLocator = sourceKey(options)
  const locator = githubLocator(options.locator)
  const manifestPath = safePath(options.manifestPath ?? DEFAULT_MANIFEST_PATH)

  const snapshot = await options.adapter.inspect({ ...locator, ref: options.ref ?? locator.ref })
  if (snapshot.private && !options.allowPrivate)
    throw new FeedLoadError('messages.public_feeds_cannot_read_private_repositories', sourceLocator)
  const headSha = snapshot.headSha
  const cached = await options.cache?.read(sourceLocator, manifestPath, headSha)
  if (cached) return { sourceLocator, manifestPath, feed: assertEventFeed(cached.feed, validator, sourceLocator), headSha, locator }
  const file = await options.adapter.readFile(locator, manifestPath, { ref: headSha })
  let feed = assertEventFeed(parseYaml<unknown>(file.content), validator, sourceLocator)

  if (feed.eventsGlob !== undefined || !feed.events) {
    feed = await expandEventsGlob(
      feed,
      locator,
      headSha,
      options.adapter,
      validator,
      sourceLocator,
    )
  }

  await options.cache?.write({ sourceLocator, manifestPath, feed, headSha })
  return { sourceLocator, manifestPath, feed, headSha, locator }
}
