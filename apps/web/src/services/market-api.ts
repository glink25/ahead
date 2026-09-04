import { CdnReadAdapter } from '@ahead/github'
import { parseLocator, parseYaml, sourceKey } from '@ahead/protocol'
import {
  createValidator,
  type Subscription,
  type UserData,
} from '@ahead/schema'
import {
  assertEventFeed,
  fetchFeed,
  loadFeedFromListing,
  type LoadedFeed,
} from '../lib/feed-loader'
import { loadMarketPage, type MarketListing } from '../lib/market'
import { RepoCache } from '../lib/repo-cache'
import type { KeyValueStore } from '../lib/idb'
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
    snapshot: () =>
      this.options.storage
        .get<MarketListing[]>('market:' + this.options.repository)
        .catch(() => undefined),
    stream: (
      options: {
        cursor?: string
        refresh?: boolean
        signal?: AbortSignal
      } = {},
    ) => this.stream(options),
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
  constructor(
    private options: {
      repository: string
      client: PublicReadClient
      storage: KeyValueStore
      cache: RepoCache
    },
  ) {}

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
      if (source.kind === 'user-data') {
        const cached = await this.options.storage
          .get<UserData>('user:' + key)
          .catch(() => undefined)
        if (cached && validator.validate('user-data', cached).ok)
          yield {
            type: 'user',
            user: cached,
            sourceLocator: key,
            cached: true,
          }
        if (signal?.aborted || cachedOnly) return
        const snapshot = await adapter.inspect(locator)
        if (snapshot.private) throw new Error('公开关注只支持公开用户资料')
        const file = await adapter.readFile(locator, path, {
          ref: snapshot.headSha,
        })
        const user = parseYaml<UserData>(file.content)
        if (!validator.validate('user-data', user).ok)
          throw new Error('用户资料校验失败')
        await this.options.storage.set('user:' + key, user).catch(() => {})
        if (!signal?.aborted)
          yield { type: 'user', user, sourceLocator: key, cached: false }
      } else {
        let cached = await this.options.cache.readAny(key, path)
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
        const feed = await fetchFeed({
          ...source,
          adapter,
          cache: this.options.cache,
        })
        await this.remember(source)
        if (!signal?.aborted) yield { type: 'feed', feed, cached: false }
      }
    } catch (error) {
      if (!isAbort(error) && !signal?.aborted)
        yield this.error(error, key + ' 更新失败，保留可用内容')
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
  }): AsyncGenerator<MarketEvent> {
    const cursor = options.cursor ?? crypto.randomUUID()
    let session = this.sessions.get(cursor)
    if (!session) {
      if (options.cursor) throw new Error('市场读取会话已失效，请刷新')
      session = {
        page: 1,
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
              ],
            )
            .catch(() => {})
        } catch (error) {
          if (!isAbort(error) && !options.signal?.aborted) {
            yield this.error(error, '市场读取失败')
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
      } else {
        state.complete = true
        await this.options.storage
          .set('market:' + this.options.repository, [
            ...state.listings.values(),
          ])
          .catch(() => {})
        yield progress()
      }
    }
  }
}
