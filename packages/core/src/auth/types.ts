export type CredentialKind = 'github-pat' | 'github-oauth-user'

export interface AuthCredential {
  accessToken: string
  tokenType: CredentialKind
  expiresAt?: number
  scopes?: string[]
}

export interface AuthIdentity {
  login: string
  id: number
  name?: string
  avatarUrl?: string
}

export interface CapabilityReport {
  canReadPublic: boolean
  canReadPrivate: boolean
  canCreateRepository: boolean
  canWriteContents: boolean
  canReadMarketIssues: boolean
  missingScopes: string[]
  diagnostics: string[]
}

export interface AuthSession {
  providerId: string
  identity: AuthIdentity
  capabilities: CapabilityReport
}

export interface AuthProvider {
  readonly id: string
  readonly kind: 'manual' | 'redirect'
  readonly available: boolean
  authenticate(input?: unknown): Promise<AuthSession>
  restore(): Promise<AuthSession | null>
  getCredential(): Promise<AuthCredential>
  logout(): Promise<void>
}
