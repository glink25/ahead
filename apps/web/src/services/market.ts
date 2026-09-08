import { onResourceChange } from './resource-changes'
import { GitHubContentProvider } from '../adapters/github-content'
import { GitHubMarketProvider } from '../adapters/github-market'
import { database } from '../data/local'
import { authenticatedAdapter, publicReadFetch } from '../lib/auth'
import { identityScope, viewStore } from '../data/storage'
import { ResourceCache } from '../lib/resource-cache'
import { useAuthSession } from '../stores'
import { MarketApi } from './market-api'
import { PublicReadClient } from './public-read-client'
onResourceChange(({ identity, source }) => { if (current?.key.startsWith(identity + ':')) current.api.invalidateSource(source) })
database.subscribe(() => current?.api.invalidateWorkspace())
let current: { key: string; api: MarketApi } | undefined

export function marketApi(): MarketApi {
  const session = useAuthSession.getState().session
  const verified = useAuthSession.getState().verified
  const identity = identityScope(session)
  const key = `${identity}:${verified ? 'verified' : 'cached'}`
  if (current?.key === key) return current.api
  current?.api.close()
  const client = new PublicReadClient({
    fetcher: publicReadFetch(),
    authenticated: Boolean(session),
  })
  const privateAdapter = session && verified ? authenticatedAdapter(session, () => {
    const active = useAuthSession.getState()
    if (active.session?.identity.id !== session.identity.id || active.session.providerId !== session.providerId || !active.verified) throw new Error('messages.signed_in_identity_changed_please_refresh')
  }) : undefined
  const api = new MarketApi({
    account: session ? String(session.identity.id) : undefined,
    storage: viewStore(identity, 'market'),
    cache: new ResourceCache(identity),
    content: [new GitHubContentProvider(client, privateAdapter)],
    marketProvider: new GitHubMarketProvider(import.meta.env.VITE_GITHUB_MARKET_REPOSITORY || 'glink25/ahead', client),
  })
  current = { key, api }
  return api
}

useAuthSession.subscribe((next, previous) => {
  if (identityScope(next.session) !== identityScope(previous.session) || next.verified !== previous.verified) {
    // A feed-store listener may already have installed the new scoped API.
    const expected = `${identityScope(next.session)}:${next.verified ? 'verified' : 'cached'}`
    if (current && current.key !== expected) { current.api.close(); current = undefined }
  }
})
