export interface StoredOAuthCredential {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  refreshTokenExpiresAt?: number
  scopes?: string[]
}

export interface OAuthCredentialStore {
  get(): Promise<StoredOAuthCredential | null>
  set(credential: StoredOAuthCredential): Promise<void>
  clear(): Promise<void>
}
