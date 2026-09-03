import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeOAuthError,
  GitHubOAuthError,
  GitHubOAuthProvider,
  isCredentialExpired,
  isUnauthenticatedOAuthError,
  resolveExpiresAt,
} from './oauth-provider.js'

vi.mock('./capabilities.js', () => ({
  probeCapabilities: vi.fn(async () => ({
    identity: { login: 'octocat', id: 1 },
    capabilities: {
      canReadPublic: true,
      canReadPrivate: true,
      canCreateRepository: false,
      canWriteContents: true,
      canReadMarketIssues: true,
      missingScopes: [],
      diagnostics: [],
    },
    scopes: ['repo'],
  })),
}))

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

describe('GitHubOAuthError helpers', () => {
  it('classifies unauthenticated errors', () => {
    const error = new GitHubOAuthError('unauthenticated', {
      kind: 'unauthenticated',
      status: 401,
    })
    expect(isUnauthenticatedOAuthError(error)).toBe(true)
    expect(isUnauthenticatedOAuthError(new Error('boom'))).toBe(false)
  })

  it('describes network and http failures for the login UI', () => {
    expect(describeOAuthError(new GitHubOAuthError('net', { kind: 'network' }))).toMatch(/Auth 服务/)
    expect(describeOAuthError(new GitHubOAuthError('http', { kind: 'http', status: 503 }))).toContain('503')
  })
})

describe('GitHubOAuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('navigates to the Auth login endpoint with redirect_uri', async () => {
    const navigate = vi.fn()
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787/',
      redirectUri: 'http://localhost:4455/login',
      navigate,
    })

    void provider.authenticate()

    expect(navigate).toHaveBeenCalledWith(
      'http://localhost:8787/api/github/login?redirect_uri=http%3A%2F%2Flocalhost%3A4455%2Flogin',
    )
  })

  it('restores a session when the Auth cookie exchange succeeds', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      accessToken: 'ghu_test',
      expiresAt: Date.now() + 60_000,
      scopes: ['repo'],
    }), { status: 200 }))
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      fetch: fetcher,
    })

    const session = await provider.restore()

    expect(fetcher).toHaveBeenCalledWith('http://localhost:8787/api/github/token', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    expect(session?.identity.login).toBe('octocat')
  })

  it('returns null on 401 without surfacing an error', async () => {
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      fetch: async () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }),
    })

    await expect(provider.restore()).resolves.toBeNull()
  })

  it('propagates network failures so the UI can show them', async () => {
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })

    await expect(provider.restore()).rejects.toMatchObject({
      name: 'GitHubOAuthError',
      kind: 'network',
    })
  })

  it('propagates non-401 HTTP failures', async () => {
    const provider = new GitHubOAuthProvider({
      authBaseUrl: 'http://localhost:8787',
      redirectUri: 'http://localhost:4455/login',
      fetch: async () => new Response('boom', { status: 502 }),
    })

    await expect(provider.restore()).rejects.toMatchObject({
      name: 'GitHubOAuthError',
      kind: 'http',
      status: 502,
    })
  })
})
