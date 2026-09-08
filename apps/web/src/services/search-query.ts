import { marketApi } from './market'
import { database } from '../data/local'
import type { LoadedFeed } from '../lib/feed-loader'
import { ResourceCache } from '../lib/resource-cache'
import { viewStore } from '../data/storage'
import { onResourceChange } from './resource-changes'
import type { SearchFeedSession, SearchFeedStatus, SearchErrorReason, SearchProvider, SearchRequest } from './search-feed-api'

type Reference = { source: string; path: string; ids: string[] }
type Saved = { references: Reference[]; checkedAt: number }
export interface SearchSnapshot {
  feeds: LoadedFeed[]
  status: SearchFeedStatus
  error?: { message: string; reason: SearchErrorReason }
}

/** Query persistence and paging live below React. Snapshots only store references. */
export class SearchQuery {
  private state: SearchSnapshot = { feeds: [], status: 'idle' }
  private listeners = new Set<() => void>()
  private session?: SearchFeedSession
  private initialized = false
  get active() { return this.listeners.size > 0 }
  private generation = 0
  private restoreSequence = 0
  private saved: Saved = { references: [], checkedAt: 0 }
  private pending = Promise.resolve()
  private snapshots
  private cache
  private disposeChanges?: () => void
  private disposeWorkspace?: () => void
  private closed = false
  private starting?: Promise<void>
  constructor(private identity: string, private key: string, private request: SearchRequest, private provider?: SearchProvider) {
    this.snapshots = viewStore(identity, 'search', 20)
    this.cache = new ResourceCache(identity)
  }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.initialized) {
      this.initialized = true
      this.disposeWorkspace = database.subscribe(() => { void this.restore().catch((error) => this.fail(error)) })
      this.disposeChanges = onResourceChange(({ identity, source }) => {
        if (identity === this.identity && this.saved.references.some((ref) => ref.source === source)) void this.restore().catch((error) => this.fail(error))
      })
      void this.start().catch((error) => this.fail(error))
    } else { this.session?.setActive(true); this.revalidate() }
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.session?.setActive(false) }
  }
  private update(value: Partial<SearchSnapshot>) {
    if (this.closed) return
    this.state = { ...this.state, ...value }
    this.listeners.forEach((listener) => listener())
  }
  private fail(error: unknown) { this.update({ status: 'failed', error: { message: String(error), reason: 'search-unavailable' } }) }
  private async restore() {
    const sequence = ++this.restoreSequence
    const generation = this.generation
    const feeds = await Promise.all(this.saved.references.map(async (ref) => {
      const cached = marketApi().workspaceFeed(ref.source) ?? await this.cache.readAny(ref.source, ref.path, ref.ids[0])
      if (!cached) return undefined
      return { ...cached, feed: { ...cached.feed, events: cached.feed.events?.filter((event) => ref.ids.includes(event.id)) } }
    }))
    if (generation === this.generation && sequence === this.restoreSequence) this.update({ feeds: feeds.filter((feed): feed is NonNullable<typeof feed> => Boolean(feed)) })
  }
  private start(force = false): Promise<void> {
    if (this.starting) return this.starting
    this.starting = this.load(force).finally(() => { this.starting = undefined })
    return this.starting
  }
  private async load(force: boolean) {
    if (this.closed) return
    const generation = this.generation
    this.saved = await this.snapshots.get<Saved>(this.key) ?? this.saved
    if (generation !== this.generation) return
    await this.restore()
    if (!force && this.state.feeds.length && Date.now() - this.saved.checkedAt < 300_000) { this.update({ status: 'complete' }); return }
    if (!navigator.onLine) {
      this.update({ status: this.state.feeds.length ? 'complete' : 'failed' })
      return
    }
    if (!this.provider) {
      this.update({ status: this.state.feeds.length ? 'complete' : 'failed', error: this.state.feeds.length ? undefined : { message: 'messages.sign_in_to_search_github', reason: 'authentication-required' } })
      return
    }
    let received = false
    let incomplete = false
    this.session = this.provider.openSession({
      request: this.request,
      receive: (event) => {
        if (generation !== this.generation) return
        if (event.type === 'error') { incomplete = true; this.update({ error: { message: event.message, reason: event.reason } }) }
        if (event.type !== 'feed') return
        const first = !received
        received = true
        this.pending = this.pending.then(async () => {
          if (generation !== this.generation) return
          await this.cache.write({ ...event.feed, complete: false })
          if (generation !== this.generation) return
          const previous = first ? [] : this.saved.references.filter((ref) => ref.source !== event.feed.sourceLocator)
          this.saved = { checkedAt: Date.now(), references: [...previous, { source: event.feed.sourceLocator, path: event.feed.manifestPath, ids: (event.feed.feed.events ?? []).map((item) => item.id) }].slice(-200) }
          await this.snapshots.set(this.key, this.saved)
          await this.restore()
        }).catch((error) => this.fail(error))
      },
      status: (status) => {
        if (generation !== this.generation) return
        void this.pending.then(async () => {
          if (generation !== this.generation) return
          if (status === 'complete' && !received && !incomplete) {
            this.saved = { references: [], checkedAt: Date.now() }
            await this.snapshots.set(this.key, this.saved)
            this.update({ feeds: [] })
          }
          this.update({ status })
        }).catch((error) => this.fail(error))
      },
    })
    this.session.setActive(this.listeners.size > 0)
  }
  refresh = async () => {
    if (!this.listeners.size || this.closed) return
    if (this.starting) return this.starting
    this.generation++
    this.session?.close()
    this.session = undefined
    this.update({ error: undefined })
    await this.start(true)
  }
  revalidate = () => {
    if (Date.now() - this.saved.checkedAt >= 300_000) void this.refresh().catch((error) => this.fail(error))
  }
  reportVisible = (index: number, available: number) => {
    if (index >= Math.max(0, available - 3) && !this.session && this.provider) void this.refresh().catch((error) => this.fail(error))
    else this.session?.reportVisible(index, available)
  }
  close() { this.closed = true; this.generation++; this.session?.close(); this.disposeChanges?.(); this.disposeWorkspace?.(); this.listeners.clear() }
}
