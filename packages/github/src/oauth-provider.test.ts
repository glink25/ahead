import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeCapabilities } from './capabilities.js'
import {
  describeOAuthError,
  extractAuthorizedParam,
  GitHubOAuthError,
  GitHubOAuthProvider,
  isCredentialExpired,
  isUnauthenticatedOAuthError,
  parseAuthorizedPayload,
  resolveExpiresAt,
} from './oauth-provider.js'
import type { OAuthCredentialStore, StoredOAuthCredential } from './oauth-credential-store.js'

vi.mock('./capabilities.js', () => ({
  probeCapabilities: vi.fn(async () => ({
    identity: { login: 'octocat', id: 1 },
    capabilities: {
      canReadPublic: true,
      canReadPrivate: true,
      canCreateRepository: true,
      canWriteContents: true,
      canReadMarketIssues: true,
      missingScopes: [],
      diagnostics: [],
    },
    scopes: ['repo'],
  })),
}))

function memoryStore(initial: StoredOAuthCredential | null = null): OAuthCredentialStore {
  let value = initial
  return {
    get: async () => value,
    set: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    },
  }
}

describe('OAuth credential expiry', () => {
  it('converts expires_in seconds to epoch milliseconds', () => {
    expect(resolveExpiresAt({ expires_in: 3600 }, 1_000)).toBe(3_601_000)
  })

  it('normalizes epoch seconds while preserving epoch milliseconds', () => {
    expect(resolveExpiresAt({ expires_at: 2_000_000_000 })).toBe(2_000_000_000_000)
    expect(resolveExpiresAt({ expiresAt: 2_000_000_000_000 })).toBe(2_000_000_000_000)
  })

  it('treats credentials within the refresh skew as expired', () => {
    expect(isCredentialExpired(131_000, 100_000)).toBe(false)
    expect(isCredentialExpired(130_000, 100_000)).toBe(true)
    expect(isCredentialExpired(undefined, 100_000)).toBe(false)
  })
})

describe('authorized redirect parsing', () => {
  it('extracts and parses github_authorized payloads', () => {
    const url = 'http://localhost:4455/login?github_authorized=' + encodeURIComponent(JSON.stringify({
      access_token: 'ghu_test',
      refresh_token: 'ghr_test',
      expires_in: 3600,
      scope: 'repo',
    }))
    expect(extractAuthorizedParam(url)).toContain('ghu_test')
    const parsed = parseAuthorizedPayload(extractAuthorizedParam(url)!, 1_000)
    expect(parsed.accessToken).toBe('ghu_test')
    expect(parsed.refreshToken).toBe('ghr_test')
    expect(parsed.expiresAt).toBe(3_601_000)
    expect(parsed.scopes).toEqual(['repo'])
  })
})

describe('GitHubOAuthError helpers', () => {
  it('classifies unauthenticated errors', () => {
    const error = new GitHubOAuthError('unauthenticated', {
      kind: 'unauthenticated',
      status: 401,
    })
    expect(isUnauthenticatedOAuthError(error)).toBe(true)
    expect(describeOAuthError(new GitHubOAuthError('net', { kind: 'network' }))).toMatch(/Auth 服务/)
  })
})

describe('GitHubOAuthProvider', () => {
  afterEach(() => {
    vi.mocked(probeCapabilities).mockReset()
    vi.mocked(probeCapabilities).mockResolvedValue({
      identity: { login: 'octocat', id: 1 },
      capabilities: {
        canReadPublic: true,
        canReadPrivate: true,
        canCreateRepository: true,
        canWriteContents: true,
        canReadMarketIssues: true,
        missingScopes: [],
        diagnostics: [],
      },
      scopes: ['repo'],
    })
    vi.clearAllMocks()
  })

  it('navigates to the Auth login endpoint with redirect_uri', () => {
    const navigate = vi.fn()
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787/',
      redirectUri: 'http://localhost:4455/login',
      credentialStore: memoryStore(),
      navigate,
    })

    void provider.authenticate()

    expect(navigate).toHaveBeenCalledWith(
      'http://localhost:8787/api/github/login?redirect_uri=http%3A%2F%2Flocalhost%3A4455%2Flogin',
    )
  })

  it('persists credentials from a redirect and restores without calling Auth', async () => {
    const store = memoryStore()
    const fetcher = vi.fn()
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      credentialStore: store,
      fetch: fetcher,
    })

    const session = await provider.consumeRedirect(
      'http://localhost:4455/login?github_authorized=' + encodeURIComponent(JSON.stringify({
        access_token: 'ghu_test',
        expires_in: 3600,
        scope: 'repo',
      })),
    )

    expect(session?.identity.login).toBe('octocat')
    expect(await store.get()).toMatchObject({ accessToken: 'ghu_test' })

    const restored = await provider.restore()
    expect(restored?.identity.login).toBe('octocat')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps stored credentials when profile probe fails after redirect', async () => {
    vi.mocked(probeCapabilities).mockRejectedValueOnce(new Error('GitHub /user failed'))
    const store = memoryStore()
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      credentialStore: store,
    })

    const session = await provider.consumeRedirect(
      'http://localhost:4455/login?github_authorized=' + encodeURIComponent(JSON.stringify({
        access_token: 'ghu_kept',
        expires_in: 3600,
        scope: 'repo',
      })),
    )

    expect(await store.get()).toMatchObject({ accessToken: 'ghu_kept' })
    expect(session?.providerId).toBe('github-oauth')
    expect(session?.identity.login).toBe('github-user')
  })

  it('returns null when nothing is stored', async () => {
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      credentialStore: memoryStore(),
    })
    await expect(provider.restore()).resolves.toBeNull()
  })

  it('refreshes expired credentials through Auth and writes them back', async () => {
    const store = memoryStore({
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: Date.now() - 1_000,
    })
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: 'ghu_new',
      refresh_token: 'ghr_new',
      expires_in: 3600,
      scope: 'repo',
    }), { status: 200 }))
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      credentialStore: store,
      fetch: fetcher,
    })

    const credential = await provider.getCredential()
    expect(credential.accessToken).toBe('ghu_new')
    expect(fetcher).toHaveBeenCalledWith('http://localhost:8787/api/github/refresh', expect.objectContaining({
      method: 'POST',
    }))
    expect(await store.get()).toMatchObject({ accessToken: 'ghu_new', refreshToken: 'ghr_new' })
  })

  it('propagates network failures from refresh', async () => {
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      credentialStore: memoryStore({
        accessToken: 'ghu_old',
        refreshToken: 'ghr_old',
        expiresAt: Date.now() - 1_000,
      }),
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })

    await expect(provider.getCredential()).rejects.toMatchObject({
      name: 'GitHubOAuthError',
      kind: 'network',
    })
  })

  it('uses the Auth service proxy for code search', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      total_count: 1,
      incomplete_results: false,
      items: [{
        path: 'events/launch.yaml',
        repository: { name: 'calendar', owner: { login: 'alice' } },
      }],
    })))
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'https://auth.example',
      redirectUri: 'https://app.example/login',
      credentialStore: memoryStore({ accessToken: 'ghu_access' }),
      fetch: fetcher,
    })

    await expect(provider.searchCode('launch in:file', 2, 50)).resolves.toMatchObject({
      total_count: 1,
      items: [{ path: 'events/launch.yaml' }],
    })
    const [input, init] = fetcher.mock.calls[0]!
    const url = new URL(String(input))
    expect(url.origin + url.pathname).toBe('https://auth.example/api/github/search/code')
    expect(url.searchParams.get('q')).toBe('launch in:file')
    expect(url.searchParams.get('page')).toBe('2')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ghu_access')
  })
})
