import { GitHubOAuthProvider, PersonalAccessTokenProvider, OctokitAdapter, createPublicFetch } from '@ahead/github'
import { indexedDbOAuthCredentialStore, indexedDbTokenStore } from '../token-store'
import { useAuthSession } from '../stores'
export const patProvider = new PersonalAccessTokenProvider(indexedDbTokenStore)
export const oauthProvider = new GitHubOAuthProvider({
  authBaseUrl: import.meta.env.VITE_AUTH_BASE_URL,
  redirectUri: location.origin + '/login',
  credentialStore: indexedDbOAuthCredentialStore,
})
export function authenticatedAdapter(session = useAuthSession.getState().session, validate = () => {}) {
  return new OctokitAdapter(async () => {
    validate()
    const provider = session?.providerId === oauthProvider.id ? oauthProvider : patProvider
    const credential = await provider.getCredential()
    validate()
    return credential.accessToken
  })
}

export function publicReadFetch() {
  const session = useAuthSession.getState().session
  return createPublicFetch(session ? async () => {
    const provider = session.providerId === oauthProvider.id ? oauthProvider : patProvider
    const credential = await provider.getCredential()
    if (useAuthSession.getState().session?.identity.id !== session.identity.id) throw new Error('messages.signed_in_identity_changed_please_refresh')
    return credential.accessToken
  } : undefined)
}
