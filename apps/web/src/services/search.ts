import { authenticatedAdapter, oauthProvider, patProvider } from '../lib/auth'
import { useAuthSession } from '../stores'
import { createGitHubSearchRelay } from './github-search-relay'
import { SearchFeedApi } from './search-feed-api'

let current: { identity: string; api: SearchFeedApi } | undefined

/** Identity-scoped, browser-local search provider. */
export function searchFeedApi(): SearchFeedApi | undefined {
  const session = useAuthSession.getState().session
  if (!session) return undefined
  const identity = `${session.providerId}:${session.identity.id}`
  if (current?.identity === identity) return current.api
  const provider = session.providerId === oauthProvider.id ? oauthProvider : patProvider
  const api = new SearchFeedApi({
    adapter: authenticatedAdapter(session),
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
