import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleRequest, type Env } from './index.js'
import { encryptJson, encryptState } from './state.js'

const env: Env = {
  GITHUB_CLIENT_ID: 'Iv23litest',
  GITHUB_CLIENT_SECRET: 'secret',
  STATE_SECRET: 'test-state-secret',
  REDIRECT_URI_ALLOWLIST: 'http://localhost:4455,https://ahead.linkai.work',
  COOKIE_NAME: 'ahead_github_session',
  FRONTEND_ORIGIN: 'http://localhost:4455,https://ahead.linkai.work',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('handleRequest OAuth flow', () => {
  it('rejects login when redirect_uri is not allowlisted', async () => {
    const response = await handleRequest(
      new Request('https://auth.example/api/github/login?redirect_uri=https%3A%2F%2Fevil.example%2Flogin'),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid redirect_uri')
  })

  it('redirects login to GitHub authorize with encrypted state', async () => {
    const response = await handleRequest(
      new Request('https://auth.example/api/github/login?redirect_uri=http%3A%2F%2Flocalhost%3A4455%2Flogin'),
      env,
    )
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!)
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe(env.GITHUB_CLIENT_ID)
    expect(location.searchParams.get('redirect_uri')).toBe('https://auth.example/api/github/callback')
    expect(location.searchParams.get('scope')).toBe('repo')
    expect(location.searchParams.get('state')).toBeTruthy()
  })

  it('exchanges the callback code, sets the session cookie, and redirects home', async () => {
    const state = await encryptState({
      redirect_uri: 'http://localhost:4455/login',
      exp: Date.now() + 60_000,
    }, env.STATE_SECRET)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'ghu_access',
      refresh_token: 'ghr_refresh',
      expires_in: 3_600,
      refresh_token_expires_in: 86_400,
      scope: 'repo',
      token_type: 'bearer',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const response = await handleRequest(
      new Request(`https://auth.example/api/github/callback?code=abc&state=${encodeURIComponent(state)}`),
      env,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('http://localhost:4455/login')
    const cookie = response.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain(`${env.COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api/github')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('returns the access token when the session cookie is present', async () => {
    const encryptedSession = await encryptJson({
      accessToken: 'ghu_access',
      scopes: ['repo'],
      expiresAt: Date.now() + 60_000,
    }, env.STATE_SECRET)

    const response = await handleRequest(
      new Request('https://auth.example/api/github/token', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:4455',
          Cookie: `${env.COOKIE_NAME}=${encodeURIComponent(encryptedSession)}`,
          Accept: 'application/json',
        },
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4455')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    await expect(response.json()).resolves.toEqual({
      accessToken: 'ghu_access',
      expiresAt: expect.any(Number),
      scopes: ['repo'],
    })
  })

  it('returns 401 when the session cookie is missing', async () => {
    const response = await handleRequest(
      new Request('https://auth.example/api/github/token', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:4455',
          Accept: 'application/json',
        },
      }),
      env,
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
  })
})
