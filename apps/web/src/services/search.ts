import { SearchQuery } from './search-query'
import type { SearchRequest } from './search-feed-api'
import { identityScope } from '../data/storage'
import { authenticatedAdapter, oauthProvider, patProvider } from '../lib/auth'
import { useAuthSession } from '../stores'
import { createGitHubSearchRelay } from './github-search-relay'
import type { SearchProvider } from './search-feed-api'
import { GitHubSearchProvider } from '../adapters/github-search'

let current: { identity: string; api: SearchProvider } | undefined

/** Identity-scoped, browser-local search provider. */
export function searchFeedApi(): SearchProvider | undefined {
  const session = useAuthSession.getState().session
  if (!session) return undefined
  const identity = `${session.providerId}:${session.identity.id}`
  if (current?.identity === identity) return current.api
  const provider = session.providerId === oauthProvider.id ? oauthProvider : patProvider
  const api = new GitHubSearchProvider({
    adapter: authenticatedAdapter(session, () => {
      const active = useAuthSession.getState()
      if (active.session?.providerId !== session.providerId || active.session.identity.id !== session.identity.id || !active.verified) throw new Error('messages.signed_in_identity_changed_please_refresh')
    }),
    search: createGitHubSearchRelay({
      baseUrl: import.meta.env.VITE_AUTH_BASE_URL,
      getAccessToken: async () => {
        const credential = await provider.getCredential()
        const active = useAuthSession.getState().session
        if (active?.providerId !== session.providerId || active.identity.id !== session.identity.id)
          throw new Error('messages.signed_in_identity_changed_please_refresh')
        return credential.accessToken
      },
    }),
  })
  current = { identity, api }
  return api
}

const queries = new Map<string, SearchQuery>()
let queryScope = ''
export function searchQuery(request: SearchRequest): SearchQuery {
  const { session, verified } = useAuthSession.getState()
  const identity = identityScope(session)
  const scope = `${identity}:${verified}`
  if (queryScope !== scope) {
    queries.forEach((query) => query.close())
    queries.clear()
    queryScope = scope
  }
  const key = 'tag' in request ? 'tag:' + request.tag!.trim().toLowerCase() : 'query:' + request.query.normalize('NFKC').trim()
  let query = queries.get(key)
  if (!query) {
    query = new SearchQuery(identity, key, request, verified ? searchFeedApi() : undefined)
    queries.set(key, query)
    for (const [oldKey, old] of queries) {
      if (queries.size <= 20) break
      if (oldKey !== key && !old.active) { old.close(); queries.delete(oldKey) }
    }
  }
  return query
}
export function revalidateSearch() { queries.forEach((query) => query.revalidate()) }

useAuthSession.subscribe((next, previous) => {
  if (identityScope(next.session) !== identityScope(previous.session) || next.verified !== previous.verified) {
    queries.forEach((query) => query.close())
    queries.clear()
    queryScope = ''
    current = undefined
  }
})
