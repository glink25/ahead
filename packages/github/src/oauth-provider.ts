import type { AuthCredential, AuthProvider, AuthSession } from '@ahead/core'
import { deriveCapabilitiesFromScopes } from '@ahead/core'
import { probeCapabilities } from './capabilities.js'
import type { OAuthCredentialStore, StoredOAuthCredential } from './oauth-credential-store.js'

type Fetch = typeof globalThis.fetch

interface OAuthTokenResponse {
  accessToken?: string
  access_token?: string
  refreshToken?: string
  refresh_token?: string
  expiresAt?: number
  expires_at?: number
  expiresIn?: number
  expires_in?: number
  refreshTokenExpiresIn?: number
  refresh_token_expires_in?: number
  scopes?: string[]
  scope?: string
}

export interface GitHubCodeSearchResult {
  total_count: number
  incomplete_results: boolean
  items: { path: string; repository: { name: string; owner: { login: string } } }[]
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

export function resolveRefreshTokenExpiresAt(
  response: OAuthTokenResponse,
  now = Date.now(),
): number | undefined {
  const seconds = response.refreshTokenExpiresIn ?? response.refresh_token_expires_in
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
      return '无法刷新 GitHub OAuth 令牌：Auth 服务不可达。请确认本地已启动 pnpm dev:auth，或检查 CSP / CORS。'
    }
    if (error.kind === 'http') {
      return `GitHub OAuth 令牌刷新失败（HTTP ${error.status ?? 'unknown'}）。`
    }
    if (error.kind === 'invalid_response') {
      return error.message
    }
  }
  if (error instanceof Error && error.message) return error.message
  return 'GitHub OAuth 失败'
}

export function parseAuthorizedPayload(raw: string, now = Date.now()): StoredOAuthCredential {
  let body: OAuthTokenResponse
  try {
    body = JSON.parse(raw) as OAuthTokenResponse
  } catch (cause) {
    throw new GitHubOAuthError('github_authorized payload is not valid JSON', {
      kind: 'invalid_response',
      cause,
    })
  }
  const accessToken = body.accessToken ?? body.access_token
  if (!accessToken) {
    throw new GitHubOAuthError('github_authorized payload did not include an access token', {
      kind: 'invalid_response',
    })
  }
  const refreshToken = body.refreshToken ?? body.refresh_token
  const scopes = body.scopes ?? body.scope?.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean)
  const expiresAt = resolveExpiresAt(body, now)
  const refreshTokenExpiresAt = resolveRefreshTokenExpiresAt(body, now)
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt }),
    ...(scopes?.length ? { scopes } : {}),
  }
}

export function extractAuthorizedParam(url: string | URL): string | null {
  const parsed = typeof url === 'string' ? new URL(url) : url
  return parsed.searchParams.get('github_authorized')
}

export interface GitHubOAuthProviderOptions {
  authBaseUrl?: string
  redirectUri?: string
  credentialStore: OAuthCredentialStore
  fetch?: Fetch
  navigate?: (url: string) => void
}

export class GitHubOAuthProvider implements AuthProvider {
  readonly id = 'github-oauth'
  readonly kind = 'redirect'
  readonly available: boolean
  private readonly authBaseUrl: string
  private readonly redirectUri: string
  private readonly credentialStore: OAuthCredentialStore
  private readonly fetcher: Fetch
  private readonly navigate: (url: string) => void
  private credential: AuthCredential | null = null

  constructor(options: GitHubOAuthProviderOptions) {
    this.authBaseUrl = options.authBaseUrl?.replace(/\/+$/, '') ?? ''
    this.redirectUri = options.redirectUri ?? globalThis.location?.href ?? ''
    this.credentialStore = options.credentialStore
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
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

  async consumeRedirect(url: string | URL = globalThis.location?.href ?? ''): Promise<AuthSession | null> {
    if (!url) return null
    const authorized = extractAuthorizedParam(url)
    if (!authorized) return null
    const stored = parseAuthorizedPayload(authorized)
    await this.persist(stored)

    try {
      const probe = await probeCapabilities(async () => stored.accessToken)
      return {
        providerId: this.id,
        identity: probe.identity,
        capabilities: probe.capabilities,
      }
    } catch {
      // Persistence already succeeded — do not discard the credential if /user probing fails.
      return {
        providerId: this.id,
        identity: {
          login: 'github-user',
          id: 0,
        },
        capabilities: deriveCapabilitiesFromScopes(stored.scopes ?? []),
      }
    }
  }

  async restore(): Promise<AuthSession | null> {
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
      // Stale local token that cannot be refreshed — clear and treat as logged out
      if (error instanceof GitHubOAuthError && (error.kind === 'http' || error.kind === 'invalid_response')) {
        await this.credentialStore.clear()
        return null
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async getCredential(): Promise<AuthCredential> {
    if (this.credential && !isCredentialExpired(this.credential.expiresAt)) {
      return this.credential
    }

    const stored = await this.credentialStore.get()
    if (!stored?.accessToken) {
      throw new GitHubOAuthError('No GitHub OAuth credential is stored', {
        kind: 'unauthenticated',
      })
    }

    if (!isCredentialExpired(stored.expiresAt)) {
      this.credential = toAuthCredential(stored)
      return this.credential
    }

    if (!stored.refreshToken) {
      await this.credentialStore.clear()
      throw new GitHubOAuthError('GitHub OAuth credential expired without a refresh token', {
        kind: 'unauthenticated',
      })
    }
    if (
      stored.refreshTokenExpiresAt !== undefined
      && stored.refreshTokenExpiresAt <= Date.now()
    ) {
      await this.credentialStore.clear()
      throw new GitHubOAuthError('GitHub OAuth refresh token expired', {
        kind: 'unauthenticated',
      })
    }

    const refreshed = await this.refreshCredential(stored.refreshToken)
    await this.persist(refreshed)
    return this.credential!
  }

  async logout(): Promise<void> {
    this.credential = null
    await this.credentialStore.clear()
  }

  async searchCode(
    query: string,
    page = 1,
    perPage = 100,
    signal?: AbortSignal,
  ): Promise<GitHubCodeSearchResult> {
    if (!this.available) throw new Error('GitHub OAuth is not configured')
    const credential = await this.getCredential()
    const url = new URL(`${this.authBaseUrl}/api/github/search/code`)
    url.searchParams.set('q', query)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(perPage))
    let response: Response
    try {
      response = await this.fetcher(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${credential.accessToken}`,
        },
        signal,
      })
    } catch (cause) {
      throw new GitHubOAuthError('GitHub code search proxy request failed', {
        kind: 'network',
        cause,
      })
    }
    const text = await response.text()
    if (!response.ok) {
      let detail = text.slice(0, 300)
      try {
        detail = (JSON.parse(text) as { message?: string }).message ?? detail
      } catch {
        /* Non-JSON proxy error. */
      }
      throw new GitHubOAuthError(
        `GitHub code search failed with HTTP ${response.status}: ${detail}`,
        { kind: response.status === 401 ? 'unauthenticated' : 'http', status: response.status },
      )
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch (cause) {
      throw new GitHubOAuthError('GitHub code search returned invalid JSON', {
        kind: 'invalid_response',
        cause,
      })
    }
    if (!isCodeSearchResult(body)) {
      throw new GitHubOAuthError('GitHub code search returned an invalid response', {
        kind: 'invalid_response',
      })
    }
    return body
  }

  private async refreshCredential(refreshToken: string): Promise<StoredOAuthCredential> {
    if (!this.available) {
      throw new Error('GitHub OAuth is not configured')
    }

    let response: Response
    try {
      response = await this.fetcher(`${this.authBaseUrl}/api/github/refresh`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      })
    } catch (cause) {
      throw new GitHubOAuthError('GitHub OAuth refresh request failed to reach the Auth service', {
        kind: 'network',
        cause,
      })
    }

    if (response.status === 401) {
      throw new GitHubOAuthError('GitHub OAuth refresh was rejected', {
        kind: 'unauthenticated',
        status: 401,
      })
    }
    if (!response.ok) {
      throw new GitHubOAuthError(
        `GitHub OAuth refresh failed with HTTP ${response.status}`,
        { kind: 'http', status: response.status },
      )
    }

    const body = await response.json() as OAuthTokenResponse
    return parseAuthorizedPayload(JSON.stringify(body))
  }

  private async persist(stored: StoredOAuthCredential): Promise<void> {
    await this.credentialStore.set(stored)
    this.credential = toAuthCredential(stored)
  }
}

function isCodeSearchResult(value: unknown): value is GitHubCodeSearchResult {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<GitHubCodeSearchResult>
  return typeof body.total_count === 'number' &&
    typeof body.incomplete_results === 'boolean' &&
    Array.isArray(body.items) && body.items.every((item) =>
      typeof item?.path === 'string' &&
      typeof item.repository?.name === 'string' &&
      typeof item.repository.owner?.login === 'string')
}

function toAuthCredential(stored: StoredOAuthCredential): AuthCredential {
  return {
    accessToken: stored.accessToken,
    tokenType: 'github-oauth-user',
    ...(stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt }),
    ...(stored.scopes?.length ? { scopes: stored.scopes } : {}),
  }
}
