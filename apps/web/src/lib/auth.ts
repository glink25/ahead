import { GitHubOAuthProvider, PersonalAccessTokenProvider, OctokitAdapter } from '@ahead/github'
import { indexedDbOAuthCredentialStore, indexedDbTokenStore } from '../token-store'
import { useAuthSession } from '../stores'
export const patProvider = new PersonalAccessTokenProvider(indexedDbTokenStore)
export const oauthProvider = new GitHubOAuthProvider({
  authBaseUrl: import.meta.env.VITE_AUTH_BASE_URL,
  redirectUri: location.origin + '/login',
  credentialStore: indexedDbOAuthCredentialStore,
})
export function authenticatedAdapter(session = useAuthSession.getState().session) {
  return new OctokitAdapter(async () => {
    const provider = session?.providerId === oauthProvider.id ? oauthProvider : patProvider
    return (await provider.getCredential()).accessToken
  })
}
