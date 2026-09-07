import { authenticatedAdapter, publicReadFetch } from '../lib/auth'
import { createIdbStore } from '../lib/idb'
import { RepoCache } from '../lib/repo-cache'
import { useAuthSession } from '../stores'
import { MarketApi } from './market-api'
import { PublicReadClient } from './public-read-client'
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
  const privateAdapter = session ? authenticatedAdapter(session) : undefined
  const api = new MarketApi({
    repository:
      import.meta.env.VITE_GITHUB_MARKET_REPOSITORY || 'glink25/ahead',
    client,
    storage: createIdbStore('ahead-market-' + suffix, 'data'),
    cache: new RepoCache(
      createIdbStore('ahead-public-feeds-' + suffix, 'feeds'),
    ),
    ...(session ? { privateAdapter } : {}),
  })
  current = { identity, api }
  return api
}
