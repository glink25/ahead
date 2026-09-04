import { create } from 'zustand'
import { CdnReadAdapter } from '@ahead/github'
import { parseLocator, parseYaml, sourceKey } from '@ahead/protocol'
import { createValidator, type Subscription, type UserData } from '@ahead/schema'
import { createIdbStore } from '../lib/idb'
import { changeProfile, emptyProfile, type ProfileAction } from '../lib/local-profile'
import { loadMarketListings, type MarketListing } from '../lib/market'
import { assertEventFeed, fetchFeed, loadFeedFromListing, type LoadedFeed } from '../lib/feed-loader'
import { RepoCache } from '../lib/repo-cache'

const storage = createIdbStore('ahead-local-profile', 'data')
const cache = new RepoCache()
let writes = Promise.resolve()
let initializing: Promise<void> | undefined
const repository = import.meta.env.VITE_GITHUB_MARKET_REPOSITORY || 'glink25/ahead'
interface FeedStore {
  profile: UserData
  feeds: LoadedFeed[]
  listings: MarketListing[]
  users: { user: UserData; sourceLocator: string }[]
  loading: boolean
  ready: boolean
  errors: string[]
  undoProfile?: UserData
  initialize(): Promise<void>
  refresh(): Promise<void>
  act(action: ProfileAction): void
  undo(): void
  replaceProfile(profile: UserData): void
}
const validator = createValidator()
function usableFeed(feed: unknown): boolean {
  try { assertEventFeed(feed, validator, 'cache'); return true } catch { return false }
}
export const useFeedStore = create<FeedStore>((set, get) => {
  const persist = (profile: UserData) => {
    writes = writes.catch(() => {}).then(() => storage.set('profile', profile)).catch(() => {
      set((s) => ({ errors: [...s.errors, '本地存储不可用；当前操作仅保留在本次打开中。'] }))
    })
  }
  return {
    profile: emptyProfile(), feeds: [], listings: [], users: [], loading: false, ready: false, errors: [],
    initialize() {
      initializing ??= (async () => {
        try {
          const profile = await storage.get<UserData>('profile')
          if (profile && validator.validate('user-data', profile).ok) set({ profile })
        } catch { set({ errors: ['无法恢复本地数据；请检查浏览器存储权限。'] }) }
        // Warm start does not wait for any network request.
        const listings = await storage.get<MarketListing[]>('market:' + repository).catch(() => undefined) ?? []
        set({ listings })
        const known = await storage.get<Subscription[]>('known').catch(() => undefined) ?? []
        const warm: LoadedFeed[] = []
        for (const source of known) {
          try {
            const key = sourceKey(source), path = source.manifestPath ?? 'ahead.yaml'
            const stored = await cache.readAny(key, path)
            const locator = parseLocator(source.locator)
            if (stored && 'owner' in locator && usableFeed(stored.feed)) warm.push({ ...stored, locator })
          } catch { /* one corrupt cached entry must not block startup */ }
        }
        set({ feeds: warm })
        set({ ready: true })
        await get().refresh()
      })()
      return initializing
    },
    async refresh() {
      if (get().loading) return
      set({ loading: true, errors: [] })
      try {
        let listings: MarketListing[]
        try {
          listings = await loadMarketListings({ repository })
          await storage.set('market:' + repository, listings).catch(() => {})
        } catch (error) {
          listings = await storage.get<MarketListing[]>('market:' + repository).catch(() => undefined) ?? []
          set((s) => ({ errors: [...s.errors, '市场刷新失败，显示上次缓存：' + String(error)] }))
        }
        set({ listings })
        // Known sources keep individual favorites available after delisting.
        const known = await storage.get<Subscription[]>('known').catch(() => undefined) ?? []
        const sources = new Map<string, Subscription>()
        for (const source of [...known, ...listings.map((l) => ({ ...l.source, kind: l.source.resourceType })), ...(get().profile.subscriptions ?? [])]) {
          if (source.kind === 'user-data') continue
          try { sources.set(sourceKey(source), { locator: source.locator, manifestPath: source.manifestPath, kind: 'event-feed' }) } catch { /* invalid registry item */ }
        }
        await storage.set('known', [...sources.values()]).catch(() => {})
        const adapter = new CdnReadAdapter()
        const users: { user: UserData; sourceLocator: string }[] = []
        // Only explicitly followed public profiles contribute recommendation signals.
        for (const source of (get().profile.subscriptions ?? []).filter((s) => s.kind === 'user-data')) {
          const key = sourceKey(source), locator = parseLocator(source.locator)
          if (!('owner' in locator)) continue
          let user = await storage.get<UserData>('user:' + key).catch(() => undefined)
          try {
            const snapshot = await adapter.inspect(locator)
            if (snapshot.private) throw new Error('公开关注只支持公开用户资料')
            const file = await adapter.readFile(locator, source.manifestPath ?? 'ahead.yaml', { ref: snapshot.headSha })
            const next = parseYaml<UserData>(file.content)
            if (!validator.validate('user-data', next).ok) throw new Error('用户资料校验失败')
            user = next
            await storage.set('user:' + key, next).catch(() => {})
          } catch (error) { set((s) => ({ errors: [...s.errors, key + ' 用户资料刷新失败：' + String(error)] })) }
          if (user && validator.validate('user-data', user).ok) users.push({ user, sourceLocator: key })
        }
        set({ users })
        const list = [...sources.values()]
        const put = (feed: LoadedFeed) => set((s) => ({ feeds: [...s.feeds.filter((f) => f.sourceLocator !== feed.sourceLocator), feed] }))
        // Bounded concurrency, shared repository inspection, progressive rendering.
        let cursor = 0
        await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => {
          while (cursor < list.length) {
            const source = list[cursor++]!
            const key = sourceKey(source)
            const path = source.manifestPath ?? 'ahead.yaml'
            const locator = parseLocator(source.locator)
            if (!('owner' in locator)) continue
            const cached = await cache.readAny(key, path)
            if (cached && usableFeed(cached.feed)) put({ ...cached, locator })
            try {
              put(await fetchFeed({ ...source, adapter, cache }))
            } catch (error) {
              if (!cached) {
                const legacy = listings.find((l) => sourceKey(l.source) === key)
                try {
                  const fallback = legacy && loadFeedFromListing(legacy, validator)
                  if (fallback && !fallback.feed.eventsGlob) put(fallback)
                } catch { /* rejected legacy cache */ }
              }
              set((s) => ({ errors: [...s.errors, source.locator + '/' + path + ' 加载失败，保留可用缓存：' + String(error)] }))
            }
          }
        }))
      } catch (error) {
        set((s) => ({ errors: [...s.errors, String(error)] }))
      } finally { set({ loading: false }) }
    },
    act(action) {
      try {
        const previous = get().profile
        const profile = changeProfile(previous, action)
        set({ profile, undoProfile: previous })
        persist(profile)
        if ('source' in action && action.source.kind === 'user-data') void get().refresh()
      } catch (error) { set((s) => ({ errors: [...s.errors, String(error)] })) }
    },
    undo() {
      const profile = get().undoProfile
      if (profile) { set({ profile, undoProfile: undefined }); persist(profile) }
    },
    replaceProfile(profile) {
      if (!validator.validate('user-data', profile).ok) throw new Error('无效的个人数据')
      set({ profile, undoProfile: get().profile })
      persist(profile)
    },
  }
})
