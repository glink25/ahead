import { authenticatedAdapter, publicReadFetch } from '../lib/auth'
import { createIdbStore, type KeyValueStore } from '../lib/idb'
import { RepoCache } from '../lib/repo-cache'
import { useAuthSession } from '../stores'
import { MarketApi } from './market-api'
import { PublicReadClient } from './public-read-client'
// Previous versions stored only public feed/profile data in these stores. Read-through
// preserves existing offline content while all new writes go to identity-scoped stores.
function withLegacy(
  primary: KeyValueStore,
  legacy: KeyValueStore,
): KeyValueStore {
  return {
    ...primary,
    get: async <T>(key: string) =>
      (await primary.get<T>(key)) ?? legacy.get<T>(key),
    keys: async () => [
      ...new Set([...(await primary.keys()), ...(await legacy.keys())]),
    ],
    update: async <T>(key: string, change: (value: T | undefined) => T) => {
      const previous = await legacy.get<T>(key).catch(() => undefined)
      return primary.update<T>(key, (value) => change(value ?? previous))
    },
  }
}
let current: { identity: string; api: MarketApi } | undefined

export function marketApi(): MarketApi {
  const session = useAuthSession.getState().session
  const identity = session
    ? `${session.providerId}:${session.identity.id}`
    : 'guest'
  if (current?.identity === identity) return current.api
  const suffix = encodeURIComponent(identity)
  const client = new PublicReadClient({
    fetcher: publicReadFetch(),
    authenticated: Boolean(session),
    store: createIdbStore('ahead-public-api-' + suffix, 'responses'),
  })
  const api = new MarketApi({
    repository:
      import.meta.env.VITE_GITHUB_MARKET_REPOSITORY || 'glink25/ahead',
    client,
    storage: withLegacy(
      createIdbStore('ahead-market-' + suffix, 'data'),
      createIdbStore('ahead-local-profile', 'data'),
    ),
    cache: new RepoCache(
      withLegacy(
        createIdbStore('ahead-public-feeds-' + suffix, 'feeds'),
        createIdbStore('ahead-repo-cache', 'feeds'),
      ),
    ),
    ...(session
      ? {
          privateAdapter: authenticatedAdapter(session),
          searchFetcher: publicReadFetch(),
        }
      : {}),
  })
  current = { identity, api }
  return api
}
