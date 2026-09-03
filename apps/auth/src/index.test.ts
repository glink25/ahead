import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleRequest, type Env } from './index.js'
import { encryptState } from './state.js'

const env: Env = {
  GITHUB_CLIENT_ID: 'Iv23litest',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_APP_SLUG: 'ahead-days-for-all',
  STATE_SECRET: 'test-state-secret',
  REDIRECT_URI_ALLOWLIST: 'http://localhost:4455,https://ahead.linkai.work',
  FRONTEND_ORIGIN: 'http://localhost:4455,https://ahead.linkai.work',
}

const tokenPayload = {
  access_token: 'ghu_access',
  refresh_token: 'ghr_refresh',
  expires_in: 3_600,
  refresh_token_expires_in: 86_400,
  scope: 'repo',
  token_type: 'bearer',
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

  it('exchanges the callback code and redirects with github_authorized when App is installed', async () => {
    const state = await encryptState({
      redirect_uri: 'http://localhost:4455/login',
      exp: Date.now() + 60_000,
    }, env.STATE_SECRET)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('login/oauth/access_token')) {
        return new Response(JSON.stringify(tokenPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/user/installations')) {
        return new Response(JSON.stringify({ total_count: 1, installations: [{ id: 1 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    const response = await handleRequest(
      new Request(`https://auth.example/api/github/callback?code=abc&state=${encodeURIComponent(state)}`),
      env,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('Set-Cookie')).toBeNull()
    const location = new URL(response.headers.get('Location')!)
    expect(location.origin + location.pathname).toBe('http://localhost:4455/login')
    expect(JSON.parse(location.searchParams.get('github_authorized')!)).toEqual(tokenPayload)
  })

  it('redirects to App installation when the user has not installed the App', async () => {
    const state = await encryptState({
      redirect_uri: 'http://localhost:4455/login',
      exp: Date.now() + 60_000,
    }, env.STATE_SECRET)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('login/oauth/access_token')) {
        return new Response(JSON.stringify(tokenPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/user/installations')) {
        return new Response(JSON.stringify({ total_count: 0, installations: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    const response = await handleRequest(
      new Request(`https://auth.example/api/github/callback?code=abc&state=${encodeURIComponent(state)}`),
      env,
    )

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!)
    expect(location.origin + location.pathname).toBe(
      `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
    )
    expect(location.searchParams.get('state')).toBe(state)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('refreshes tokens via JSON body without cookies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(tokenPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const response = await handleRequest(
      new Request('https://auth.example/api/github/refresh', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:4455',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ refreshToken: 'ghr_old' }),
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4455')
    await expect(response.json()).resolves.toEqual(tokenPayload)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('returns 404 for the retired cookie token endpoint', async () => {
    const response = await handleRequest(
      new Request('https://auth.example/api/github/token', { method: 'POST' }),
      env,
    )
    expect(response.status).toBe(404)
  })
})
