import type { AuthCredential, AuthProvider, AuthSession } from '@ahead/core'
import { probeCapabilities } from './capabilities.js'

type Fetch = typeof globalThis.fetch

interface OAuthTokenResponse {
  accessToken?: string
  access_token?: string
  expiresAt?: number
  expires_at?: number
  expiresIn?: number
  expires_in?: number
  scopes?: string[]
  scope?: string
}

export function resolveExpiresAt(
  response: OAuthTokenResponse,
  now = Date.now(),
): number | undefined {
  const absolute = response.expiresAt ?? response.expires_at
  if (absolute !== undefined) {
    return absolute < 10_000_000_000 ? absolute * 1000 : absolute
  }
  const seconds = response.expiresIn ?? response.expires_in
  return seconds === undefined ? undefined : now + seconds * 1000
}

export function isCredentialExpired(
  expiresAt: number | undefined,
  now = Date.now(),
  skewMs = 30_000,
): boolean {
  return expiresAt !== undefined && expiresAt <= now + skewMs
}

export class GitHubOAuthError extends Error {
  readonly status?: number
  readonly kind: 'unauthenticated' | 'http' | 'network' | 'invalid_response'

  constructor(
    message: string,
    options: {
      kind: GitHubOAuthError['kind']
      status?: number
      cause?: unknown
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'GitHubOAuthError'
    this.kind = options.kind
    if (options.status !== undefined) this.status = options.status
  }
}

export function isUnauthenticatedOAuthError(error: unknown): boolean {
  return error instanceof GitHubOAuthError && error.kind === 'unauthenticated'
}

export function describeOAuthError(error: unknown): string {
  if (error instanceof GitHubOAuthError) {
    if (error.kind === 'network') {
      return '无法连接 Auth 服务。请确认本地已启动 pnpm dev:auth，或检查浏览器是否拦截了 Auth API（CSP / CORS）。'
    }
    if (error.kind === 'http') {
      return `GitHub OAuth 会话恢复失败（HTTP ${error.status ?? 'unknown'}）。`
    }
    if (error.kind === 'invalid_response') {
      return error.message
    }
  }
  if (error instanceof Error && error.message) return error.message
  return 'GitHub OAuth 会话恢复失败'
}

export interface GitHubOAuthProviderOptions {
  authBaseUrl?: string
  redirectUri?: string
  fetch?: Fetch
  navigate?: (url: string) => void
}

export class GitHubOAuthProvider implements AuthProvider {
  readonly id = 'github-oauth'
  readonly kind = 'redirect'
  readonly available: boolean
  private readonly authBaseUrl: string
  private readonly redirectUri: string
  private readonly fetcher: Fetch
  private readonly navigate: (url: string) => void
  private credential: AuthCredential | null = null

  constructor(options: GitHubOAuthProviderOptions) {
    this.authBaseUrl = options.authBaseUrl?.replace(/\/+$/, '') ?? ''
    this.redirectUri = options.redirectUri ?? globalThis.location?.href ?? ''
    this.fetcher = options.fetch ?? globalThis.fetch
    this.navigate = options.navigate ?? ((url) => globalThis.location.assign(url))
    this.available = this.authBaseUrl.length > 0
  }

  authenticate(): Promise<AuthSession> {
    if (!this.available) {
      throw new Error('GitHub OAuth is not configured')
    }
    const url = `${this.authBaseUrl}/api/github/login?redirect_uri=${encodeURIComponent(this.redirectUri)}`
    this.navigate(url)
    return new Promise<AuthSession>(() => undefined)
  }

  async restore(): Promise<AuthSession | null> {
    if (!this.available) return null
    try {
      const credential = await this.getCredential()
      const probe = await probeCapabilities(async () => credential.accessToken)
      return {
        providerId: this.id,
        identity: probe.identity,
        capabilities: probe.capabilities,
      }
    } catch (error) {
      this.credential = null
      if (isUnauthenticatedOAuthError(error)) return null
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async getCredential(): Promise<AuthCredential> {
    if (this.credential && !isCredentialExpired(this.credential.expiresAt)) {
      return this.credential
    }
    if (!this.available) {
      throw new Error('GitHub OAuth is not configured')
    }

    let response: Response
    try {
      response = await this.fetcher(`${this.authBaseUrl}/api/github/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
    } catch (cause) {
      throw new GitHubOAuthError('GitHub OAuth token request failed to reach the Auth service', {
        kind: 'network',
        cause,
      })
    }
    if (response.status === 401) {
      throw new GitHubOAuthError('GitHub OAuth session is unauthenticated', {
        kind: 'unauthenticated',
        status: 401,
      })
    }
    if (!response.ok) {
      throw new GitHubOAuthError(
        `GitHub OAuth token request failed with HTTP ${response.status}`,
        { kind: 'http', status: response.status },
      )
    }
    const body = await response.json() as OAuthTokenResponse
    const accessToken = body.accessToken ?? body.access_token
    if (!accessToken) {
      throw new GitHubOAuthError('GitHub OAuth token response did not include an access token', {
        kind: 'invalid_response',
      })
    }
    const scopes = body.scopes ?? body.scope?.split(',').map((scope) => scope.trim()).filter(Boolean)
    const expiresAt = resolveExpiresAt(body)
    this.credential = {
      accessToken,
      tokenType: 'github-oauth-user',
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(scopes?.length ? { scopes } : {}),
    }
    return this.credential
  }

  async logout(): Promise<void> {
    this.credential = null
    if (!this.available) return
    const response = await this.fetcher(`${this.authBaseUrl}/api/github/logout`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(`GitHub OAuth logout failed with HTTP ${response.status}`)
    }
  }
}
