import type { TokenStore } from '@ahead/core'
import type { OAuthCredentialStore, StoredOAuthCredential } from '@ahead/github'
import { authStore } from './data/storage'
const PAT_KEY = 'github-pat'
const OAUTH_KEY = 'github-oauth'

export const indexedDbTokenStore: TokenStore = {
  get: () => authStore.get<string>(PAT_KEY).then((value) => value ?? null),
  set: (token) => authStore.set(PAT_KEY, token),
  clear: () => authStore.delete(PAT_KEY),
}

export const indexedDbOAuthCredentialStore: OAuthCredentialStore = {
  get: async () => {
    const value = await authStore.get<unknown>(OAUTH_KEY)
    if (!value || typeof value !== 'object') return null
    const record = value as StoredOAuthCredential
    return record.accessToken ? record : null
  },
  set: (credential) => authStore.set(OAUTH_KEY, credential),
  clear: () => authStore.delete(OAUTH_KEY),
}
