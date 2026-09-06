import { CdnReadAdapter } from '@ahead/github'
import { parseLocator, parseYaml, sourceKey } from '@ahead/protocol'
import {
  createValidator,
  type Event,
  type EventFeed,
  type Subscription,
  type UserData,
} from '@ahead/schema'
import {
  assertEventFeed,
  fetchFeed,
  loadFeedFromListing,
  matchesEventsGlob,
  type LoadedFeed,
} from '../lib/feed-loader'
import { loadMarketPage, type MarketListing } from '../lib/market'
import { RepoCache } from '../lib/repo-cache'
import type { KeyValueStore } from '../lib/idb'
import type { RepositoryAdapter } from '@ahead/core'
import { assertDurationFitsRecurrence } from '@ahead/resolver'
import {
  isAbort,
  PublicReadClient,
  PublicReadError,
} from './public-read-client'

type Source = Pick<Subscription, 'locator' | 'manifestPath' | 'kind'>
export type ReadEvent =
  | { type: 'feed'; feed: LoadedFeed; cached: boolean }
  | { type: 'user'; user: UserData; sourceLocator: string; cached: boolean }
  | {
      type: 'error'
      message: string
      limited: boolean
      authenticated?: boolean
    }
export type MarketEvent =
  | ReadEvent
  | { type: 'listings'; listings: MarketListing[]; cached: boolean }
  | { type: 'progress'; cursor: string; loaded: number; complete: boolean }
export type DiscoverMarketStatus = 'idle' | 'restoring' | 'expanding' | 'paused' | 'complete' | 'failed'
export interface DiscoverMarketSession {
  setActive(active: boolean): void
  reportVisible(index: number, available: number): void
  refresh(): Promise<void>
  retry(): Promise<void>
  close(): void
}
export type SearchErrorReason =
  | 'authentication-required'
  | 'authentication-expired'
  | 'rate-limited'
  | 'search-unavailable'
  | 'incomplete-results'
export type SearchEvent =
  | { type: 'feed'; feed: LoadedFeed; cached: boolean }
  | {
      type: 'error'
      message: string
      reason: SearchErrorReason
      limited: boolean
      authenticated: boolean
    }
  | { type: 'progress'; loaded: number; complete: boolean }
interface CodeSearchResult {
  total_count: number
  incomplete_results: boolean
  items: { path: string; repository: { name: string; owner: { login: string } } }[]
}
interface Session {
  page: number
  nextPage?: number
  entries?: MarketListing[]
  done: Set<string>
  listings: Map<string, MarketListing>
  refresh: boolean
  loaded: number
  complete: boolean
  fetcher: typeof fetch
}
const validator = createValidator()

/** Browser-side business API. GitHub, storage and scheduling stay behind this boundary. */
export class MarketApi {
  private sessions = new Map<string, Session>()
  readonly market = {
    snapshot: async () => {
      const listings = await this.options.storage
        .get<MarketListing[]>('market:' + this.options.repository)
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
  }
  readonly search = {
    stream: (options: {
      query?: string
      tag?: string
      signal?: AbortSignal
    }) => this.searchStream(options),
  }
  constructor(
    private options: {
      repository: string
      client: PublicReadClient
      storage: KeyValueStore
      cache: RepoCache
      privateAdapter?: RepositoryAdapter
      searchFetcher?: typeof fetch
      searchCode?: (
        query: string,
        page: number,
        perPage: number,
        signal?: AbortSignal,
      ) => Promise<CodeSearchResult>
    },
  ) {}

  private get searchAvailable() {
    return Boolean(this.options.searchCode || this.options.searchFetcher)
  }

  private async searchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    if (this.options.searchCode) {
      const parsed = new URL(url)
      return this.options.searchCode(
        parsed.searchParams.get('q') ?? '',
        Number(parsed.searchParams.get('page') ?? 1),
        Number(parsed.searchParams.get('per_page') ?? 100),
        signal,
      ) as Promise<T>
    }
    if (!this.options.searchFetcher)
      throw new PublicReadError('messages.sign_in_to_search_github', 401, false)
    const response = await this.options.searchFetcher(url, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal,
    })
    if (!response.ok) {
      const remainingHeader = response.headers.get('x-ratelimit-remaining')
      const remaining = remainingHeader === null ? undefined : Number(remainingHeader)
      const limited = response.status === 429 ||
        (response.status === 403 && remaining === 0)
      throw new PublicReadError(
        `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
        response.status,
        true,
        limited,
      )
    }
    return response.json() as Promise<T>
  }

  private searchError(error: unknown): SearchEvent & { type: 'error' } {
    const status = error instanceof PublicReadError
      ? error.status
      : typeof error === 'object' && error !== null &&
          typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 0
    const limited = error instanceof PublicReadError
      ? error.limited
      : (status === 403 || status === 429) && /rate limit|abuse|secondary rate/iu.test(String(error))
    const reason: SearchErrorReason = !this.searchAvailable
      ? 'authentication-required'
      : status === 401
        ? 'authentication-expired'
        : limited
          ? 'rate-limited'
          : 'search-unavailable'
    return {
      type: 'error',
      message: reason === 'authentication-required'
        ? 'messages.sign_in_to_search_github'
        : reason === 'authentication-expired'
          ? 'messages.github_sign_in_expired'
          : reason === 'rate-limited'
            ? 'messages.github_search_rate_limited'
            : `messages.github_search_unavailable：${String(error)}`,
      reason,
      limited: reason === 'rate-limited',
      authenticated: this.searchAvailable,
    }
  }

  private candidateRequestError(error: unknown): PublicReadError | undefined {
    if (error instanceof PublicReadError) return error
    const status = typeof error === 'object' && error !== null &&
      typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined
    if (status === 401)
      return new PublicReadError(String(error), status, true)
    if ((status === 403 || status === 429) && /rate limit|abuse|secondary rate/iu.test(String(error)))
      return new PublicReadError(String(error), status, true, true)
    return undefined
  }

  private async repositoryReader(owner: string, repo: string) {
    const locator = { scheme: 'github' as const, owner, repo }
    if (!this.options.privateAdapter)
      throw new PublicReadError('messages.sign_in_to_search_github', 401, false)
    const snapshot = await this.options.privateAdapter.inspect(locator)
    return { locator, snapshot, adapter: this.options.privateAdapter }
  }

  private async manifestPaths(
    owner: string,
    repo: string,
    ref: string,
    adapter: RepositoryAdapter,
    signal?: AbortSignal,
  ): Promise<{ path: string; feed: EventFeed }[]> {
    const q = encodeURIComponent(`\"event-feed\" \"oefVersion\" repo:${owner}/${repo} in:file`)
    const data = await this.searchJson<{
      items: { path: string }[]
    }>(`https://api.github.com/search/code?q=${q}&per_page=100`, signal)
    const manifests: { path: string; feed: EventFeed }[] = []
    for (const item of data.items) {
      if (signal?.aborted) break
      try {
        const file = await adapter.readFile({ scheme: 'github', owner, repo }, item.path, { ref })
        const document = parseYaml<unknown>(file.content)
        if (validator.validate('event-feed', document).ok) {
          assertEventFeed(document, validator, `github:${owner}/${repo}`)
          manifests.push({ path: item.path, feed: document as EventFeed })
        }
      } catch (error) {
        const requestError = this.candidateRequestError(error)
        if (requestError) throw requestError
        /* Search candidates are untrusted and may have changed. */
      }
    }
    return manifests
  }

  private async *searchStream(options: {
    query?: string
    tag?: string
    signal?: AbortSignal
  }): AsyncGenerator<SearchEvent> {
    const tag = options.tag?.trim().toLowerCase()
    const query = options.query?.normalize('NFKC').trim()
    if ((!query && !tag) || (query && tag)) return
    if (tag && !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(tag)) {
      yield { type: 'error', message: 'messages.invalid_tag', reason: 'search-unavailable', limited: false, authenticated: this.searchAvailable }
      return
    }
    if (!this.searchAvailable) {
      yield this.searchError(new Error('Authentication required'))
      return
    }
    const terms = tag
      ? [tag, 'tags', 'oefSearch', 'oef-search-v1']
      : [...query!.split(/\s+/u), 'oefSearch', 'oef-search-v1']
    const escaped = terms.map((term) => `\"${term.replace(/["\\]/gu, '\\$&')}\"`).join(' ')
    const searchQuery = `${escaped} in:file`
    const seenFiles = new Set<string>()
    const seenSources = new Set<string>()
    const manifestCache = new Map<string, Promise<{ path: string; feed: EventFeed }[]>>()
    const repositoryCache = new Map<string, ReturnType<MarketApi['repositoryReader']>>()
    let page = 1
    let loaded = 0
    let incomplete = false
    try {
      while (page <= 10 && !options.signal?.aborted) {
        const url = `https://api.github.com/search/code?q=${encodeURIComponent(searchQuery)}&per_page=100&page=${page}`
        const data = await this.searchJson<{
          total_count: number
          incomplete_results: boolean
          items: { path: string; repository: { name: string; owner: { login: string } } }[]
        }>(url, options.signal)
        incomplete ||= data.incomplete_results
        if (!data.items.length) break
        for (const item of data.items) {
          if (options.signal?.aborted) return
          const owner = item.repository.owner.login
          const repo = item.repository.name
          const fileKey = `${owner}/${repo}:${item.path}`.toLowerCase()
          if (seenFiles.has(fileKey)) continue
          seenFiles.add(fileKey)
          try {
            const repositoryKey = `${owner}/${repo}`.toLowerCase()
            let repository = repositoryCache.get(repositoryKey)
            if (!repository) {
              repository = this.repositoryReader(owner, repo)
              repositoryCache.set(repositoryKey, repository)
            }
            const { locator, snapshot, adapter } = await repository
            const file = await adapter.readFile(locator, item.path, { ref: snapshot.headSha })
            const document = parseYaml<unknown>(file.content)
            const candidates: { path: string; feed: EventFeed }[] = []
            if (validator.validate('event-feed', document).ok &&
              (document as EventFeed).oefSearch === 'oef-search-v1') {
              candidates.push({ path: item.path, feed: assertEventFeed(document, validator, `github:${owner}/${repo}`) })
            } else if (validator.validate('event', document).ok) {
              const event = document as Event
              if (event.oefSearch !== 'oef-search-v1') continue
              assertDurationFitsRecurrence(event.duration, event.recurrence)
              const repoKey = `${owner}/${repo}@${snapshot.headSha}`.toLowerCase()
              let manifests = manifestCache.get(repoKey)
              if (!manifests) {
                manifests = this.manifestPaths(owner, repo, snapshot.headSha, adapter, options.signal)
                manifestCache.set(repoKey, manifests)
              }
              for (const manifest of await manifests)
                if (matchesEventsGlob(item.path, manifest.feed.eventsGlob)) candidates.push(manifest)
            }
            for (const candidate of candidates) {
              const source = { locator: `github:${owner}/${repo}`, manifestPath: candidate.path, kind: 'event-feed' as const }
              const key = sourceKey(source)
              if (seenSources.has(key)) continue
              const full = await fetchFeed({
                ...source,
                adapter,
                ref: snapshot.headSha,
                allowPrivate: snapshot.private,
                ...(snapshot.private ? {} : { cache: this.options.cache }),
              })
              const normalized = query?.toLocaleLowerCase()
              const events = (full.feed.events ?? []).filter((event) => {
                if (tag) return event.tags?.includes(tag) ?? false
                const text = [
                  ...Object.values(event.title),
                  ...Object.values(event.summary ?? {}),
                  ...Object.values(event.description ?? {}),
                  ...(event.tags ?? []),
                ].join('\n').normalize('NFKC').toLocaleLowerCase()
                return normalized!.split(/\s+/u).every((part) => text.includes(part))
              })
              if (!events.length) continue
              seenSources.add(key)
              loaded += events.length
              yield { type: 'feed', feed: { ...full, feed: { ...full.feed, events } }, cached: false }
              yield { type: 'progress', loaded, complete: false }
            }
          } catch (error) {
            const requestError = this.candidateRequestError(error)
            if (requestError) throw requestError
            /* Invalid, inaccessible and stale candidates are omitted. */
          }
        }
        if (page * 100 >= data.total_count) break
        page++
      }
      if (incomplete)
        yield { type: 'error', message: 'messages.github_search_results_incomplete', reason: 'incomplete-results', limited: false, authenticated: true }
      yield { type: 'progress', loaded, complete: true }
    } catch (error) {
      if (!isAbort(error) && !options.signal?.aborted) yield this.searchError(error)
    }
  }

  private error(error: unknown, prefix: string): ReadEvent & { type: 'error' } {
    return {
      type: 'error',
      message: `${prefix}：${String(error)}`,
      limited: error instanceof PublicReadError && error.limited,
      authenticated:
        error instanceof PublicReadError ? error.authenticated : undefined,
    }
  }

  /** Favorites store event IDs; resolve their source association from local content only. */
  async relatedSources(profile: UserData): Promise<Source[]> {
    const sources = new Map<string, Source>()
    for (const source of profile.subscriptions ?? [])
      sources.set(sourceKey(source), source)
    const ids = new Set([...(profile.favorites ?? []), ...(profile.pins ?? [])])
    if (ids.size) {
      const known =
        (await this.options.storage
          .get<Source[]>('known')
          .catch(() => undefined)) ?? []
      for (const source of known) {
        const cached = await this.options.cache.readAny(
          sourceKey(source),
          source.manifestPath ?? 'ahead.yaml',
        )
        if (cached?.feed.events?.some((event) => ids.has(event.id)))
          sources.set(sourceKey(source), source)
      }
    }
    return [...sources.values()]
  }

  private async remember(source: Source) {
    await this.options.storage
      .update<Source[]>('known', (previous) => {
        const key = sourceKey(source)
        return [
          ...(previous ?? []).filter((item) => sourceKey(item) !== key),
          source,
        ]
      })
      .catch(() => {})
  }

  private async *readOne(
    source: Source,
    fetcher: typeof fetch,
    signal?: AbortSignal,
    legacy?: MarketListing,
    cachedOnly = false,
  ): AsyncGenerator<ReadEvent> {
    const key = sourceKey(source),
      path = source.manifestPath ?? 'ahead.yaml'
    const locator = parseLocator(source.locator)
    if (!('owner' in locator)) return
    const adapter = new CdnReadAdapter(fetcher)
    try {
      // Direct subscriptions may point at private repositories. Preflight them
      // through the authenticated adapter so private metadata and bodies never
      // enter PublicReadClient or its persistent stores.
      const authenticatedSnapshot = this.options.privateAdapter && !legacy
        ? await this.options.privateAdapter.inspect(locator).catch(() => undefined)
        : undefined
      const privateSnapshot = authenticatedSnapshot?.private
        ? authenticatedSnapshot
        : undefined
      if (source.kind === 'user-data') {
        const cached = await this.options.storage
          .get<UserData>('user:' + key)
          .catch(() => undefined)
        if (!privateSnapshot && cached && validator.validate('user-data', cached).ok)
          yield {
            type: 'user',
            user: cached,
            sourceLocator: key,
            cached: true,
          }
        if (signal?.aborted || cachedOnly) return
        const snapshot = privateSnapshot ?? await adapter.inspect(locator)
        const reader = snapshot.private ? this.options.privateAdapter : adapter
        if (!reader) throw new Error('messages.sign_in_to_view_this_resource')
        const file = await reader.readFile(locator, path, {
          ref: snapshot.headSha,
        })
        const user = parseYaml<UserData>(file.content)
        if (!validator.validate('user-data', user).ok)
          throw new Error('messages.profile_validation_failed')
        if (!snapshot.private)
          await this.options.storage.set('user:' + key, user).catch(() => {})
        if (!signal?.aborted)
          yield { type: 'user', user, sourceLocator: key, cached: false }
      } else {
        let cached = privateSnapshot
          ? undefined
          : await this.options.cache.readAny(key, path)
        if (cached) {
          try {
            assertEventFeed(cached.feed, validator, key)
          } catch {
            cached = undefined
          }
        }
        if (cached)
          yield { type: 'feed', feed: { ...cached, locator }, cached: true }
        else if (legacy) {
          try {
            const fallback = loadFeedFromListing(legacy, validator)
            if (fallback && !fallback.feed.eventsGlob)
              yield { type: 'feed', feed: fallback, cached: true }
          } catch {
            /* invalid legacy listing */
          }
        }
        if (signal?.aborted || cachedOnly) return
        const snapshot = privateSnapshot ?? await adapter.inspect(locator)
        const reader = snapshot.private ? this.options.privateAdapter : adapter
        if (!reader) throw new Error('messages.sign_in_to_view_this_resource')
        const feed = await fetchFeed({
          ...source,
          adapter: reader,
          ref: snapshot.headSha,
          allowPrivate: snapshot.private,
          ...(snapshot.private ? {} : { cache: this.options.cache }),
        })
        if (!snapshot.private) await this.remember(source)
        if (!signal?.aborted) yield { type: 'feed', feed, cached: false }
      }
    } catch (error) {
      if (!isAbort(error) && !signal?.aborted)
        yield this.error(error, key + 'messages.update_failed_available_content_was_preserved')
    }
  }

  private async *readSources(
    sources: Source[],
    options: { refresh?: boolean; signal?: AbortSignal; cachedOnly?: boolean },
  ): AsyncGenerator<ReadEvent> {
    const fetcher = this.options.client.fetch({ ...options, priority: 1 })
    for (const source of new Map(
      sources.map((source) => [sourceKey(source), source]),
    ).values()) {
      if (options.signal?.aborted) return
      for await (const event of this.readOne(
        source,
        fetcher,
        options.signal,
        undefined,
        options.cachedOnly,
      )) {
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
      const savedPage = options.refresh ? undefined : await this.options.storage
        .get<number>('market-page:' + this.options.repository)
        .catch(() => undefined)
      session = {
        page: savedPage && savedPage > 0 ? savedPage : 1,
        done: new Set(),
        listings: new Map(),
        loaded: 0,
        complete: false,
        refresh: Boolean(options.refresh),
        fetcher: this.options.client.fetch({ refresh: options.refresh }),
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
    // Bind cancellation per subscription; the refresh context survives pause/resume.
    const fetcher: typeof fetch = (input, init) =>
      state.fetcher(input, { ...init, signal: options.signal })
    if (!state.entries && state.page === 1 && !state.listings.size) {
      const cached = await this.options.storage
        .get<MarketListing[]>('market:' + this.options.repository)
        .catch(() => undefined)
      if (cached?.length) {
        yield { type: 'listings', listings: cached, cached: true }
        // Warm only the first batch; never scan/download the entire market before showing it.
        for (const listing of cached.slice(0, 20)) {
          if (options.signal?.aborted) return
          if (listing.source.resourceType !== 'event-feed') continue
          const locator = parseLocator(listing.source.locator)
          const feed = await this.options.cache.readAny(
            sourceKey(listing.source),
            listing.source.manifestPath ?? 'ahead.yaml',
          )
          if (feed && 'owner' in locator) {
            try {
              assertEventFeed(feed.feed, validator, sourceKey(listing.source))
            } catch {
              continue
            }
            yield { type: 'feed', feed: { ...feed, locator }, cached: true }
          }
        }
      }
    }
    let pagesRead = 0
    while (!state.complete && !options.signal?.aborted) {
      if (!state.entries) {
        try {
          const page = await loadMarketPage({
            repository: this.options.repository,
            page: state.page,
            perPage: 20,
            fetcher,
          })
          if (options.signal?.aborted) return
          state.entries = page.listings.filter(
            (listing) => !state.listings.has(sourceKey(listing.source)),
          )
          state.nextPage = page.nextPage
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
              'market:' + this.options.repository,
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
            const iterator = this.readOne(
              { ...listing.source, kind: 'event-feed' },
              fetcher,
              options.signal,
              listing,
            )
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
        await this.options.storage.set('market-page:' + this.options.repository, state.page).catch(() => {})
        yield progress()
        if (options.maxPages !== undefined && pagesRead >= options.maxPages) return
      } else {
        state.complete = true
        await this.options.storage.update<MarketListing[]>(
          'market:' + this.options.repository,
          (old) => [...new Map([...(old ?? []), ...state.listings.values()].map((item) => [sourceKey(item.source), item])).values()].slice(-60),
        ).catch(() => {})
        yield progress()
      }
    }
  }

  private async *restoreMarket(limit: number, signal?: AbortSignal): AsyncGenerator<MarketEvent> {
    const cached = await this.options.storage
      .get<MarketListing[]>('market:' + this.options.repository)
      .catch(() => undefined)
    if (!cached?.length || signal?.aborted) return
    const window = cached.slice(-limit)
    yield { type: 'listings', listings: window, cached: true }
    for (const listing of window) {
      if (signal?.aborted) return
      if (listing.source.resourceType !== 'event-feed') continue
      const locator = parseLocator(listing.source.locator)
      const feed = await this.options.cache.readAny(
        sourceKey(listing.source),
        listing.source.manifestPath ?? 'ahead.yaml',
      )
      if (!feed || !('owner' in locator)) continue
      try {
        assertEventFeed(feed.feed, validator, sourceKey(listing.source))
      } catch {
        continue
      }
      yield { type: 'feed', feed: { ...feed, locator }, cached: true }
    }
  }

  private async probeMarketHead(signal?: AbortSignal): Promise<MarketListing[] | undefined> {
    const stateKey = 'market-probe:' + this.options.repository
    const previous = await this.options.storage.get<{ checkedAt: number }>(stateKey).catch(() => undefined)
    if (previous && Date.now() - previous.checkedAt < 6 * 60 * 60_000) return undefined
    const result = await loadMarketPage({
      repository: this.options.repository,
      page: 1,
      perPage: 20,
      fetcher: this.options.client.fetch({ signal }),
    })
    if (signal?.aborted) return undefined
    const key = 'market:' + this.options.repository
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
