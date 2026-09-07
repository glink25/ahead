import { authenticatedAdapter, publicReadFetch } from '../lib/auth'
import { identityScope, viewStore } from '../data/storage'
import { ResourceCache } from '../lib/resource-cache'
import { useAuthSession } from '../stores'
import { MarketApi } from './market-api'
import { PublicReadClient } from './public-read-client'
let current: { key: string; api: MarketApi } | undefined

export function marketApi(): MarketApi {
  const session = useAuthSession.getState().session
  const verified = useAuthSession.getState().verified
  const identity = identityScope(session)
  const key = `${identity}:${verified ? 'verified' : 'cached'}`
  if (current?.key === key) return current.api
  const client = new PublicReadClient({
    fetcher: publicReadFetch(),
    authenticated: Boolean(session),
  })
  const privateAdapter = session && verified ? authenticatedAdapter(session) : undefined
  const api = new MarketApi({
    repository:
      import.meta.env.VITE_GITHUB_MARKET_REPOSITORY || 'glink25/ahead',
    client,
    storage: viewStore(identity, 'market'),
    cache: new ResourceCache(identity),
    ...(privateAdapter ? { privateAdapter } : {}),
  })
  current = { key, api }
  return api
}
