import { clearSessionCookie, readCookie, sessionCookie } from './cookies.js'
import { corsHeaders, preflightResponse } from './cors.js'
import { decryptJson, decryptState, encryptJson, encryptState } from './state.js'

export interface Env {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  STATE_SECRET: string
  REDIRECT_URI_ALLOWLIST: string
  COOKIE_NAME: string
  FRONTEND_ORIGIN: string
}

interface GitHubTokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface CookieSession {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  refreshTokenExpiresAt?: number
  scopes: string[]
}

function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = corsHeaders(request, env.FRONTEND_ORIGIN)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.append(key, value))
  return new Response(JSON.stringify(body), { status, headers })
}

function isAllowedRedirect(value: string, allowlist: string): boolean {
  let candidate: URL
  try {
    candidate = new URL(value)
  } catch {
    return false
  }
  return allowlist.split(',').map((entry) => entry.trim()).filter(Boolean).some((entry) => {
    try {
      const allowed = new URL(entry)
      return allowed.pathname === '/' && !allowed.search && !allowed.hash
        ? candidate.origin === allowed.origin
        : candidate.href === allowed.href
    } catch {
      return false
    }
  })
}

async function exchangeToken(params: URLSearchParams, env: Env): Promise<GitHubTokenPayload> {
  params.set('client_id', env.GITHUB_CLIENT_ID)
  params.set('client_secret', env.GITHUB_CLIENT_SECRET)
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
  if (!response.ok) throw new Error(`GitHub token exchange failed with HTTP ${response.status}`)
  const payload = await response.json() as GitHubTokenPayload
  if (!payload.access_token || payload.error) {
    throw new Error(payload.error_description ?? payload.error ?? 'GitHub did not return an access token')
  }
  return payload
}

function createCookieSession(payload: GitHubTokenPayload, now = Date.now()): CookieSession {
  return {
    accessToken: payload.access_token!,
    ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
    ...(payload.expires_in ? { expiresAt: now + payload.expires_in * 1000 } : {}),
    ...(payload.refresh_token_expires_in
      ? { refreshTokenExpiresAt: now + payload.refresh_token_expires_in * 1000 }
      : {}),
    scopes: payload.scope?.split(',').map((scope) => scope.trim()).filter(Boolean) ?? [],
  }
}

async function login(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url)
  const redirectUri = requestUrl.searchParams.get('redirect_uri')
  if (!redirectUri || !isAllowedRedirect(redirectUri, env.REDIRECT_URI_ALLOWLIST)) {
    return new Response('Invalid redirect_uri', { status: 400 })
  }
  const state = await encryptState(
    { redirect_uri: redirectUri, exp: Date.now() + 5 * 60 * 1000 },
    env.STATE_SECRET,
  )
  const callbackUrl = `${requestUrl.origin}/api/github/callback`
  const githubUrl = new URL('https://github.com/login/oauth/authorize')
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  githubUrl.searchParams.set('redirect_uri', callbackUrl)
  githubUrl.searchParams.set('scope', 'repo')
  githubUrl.searchParams.set('state', state)
  return Response.redirect(githubUrl.toString(), 302)
}

async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const encryptedState = url.searchParams.get('state')
  if (!code || !encryptedState) return new Response('Missing code or state', { status: 400 })

  try {
    const state = await decryptState(encryptedState, env.STATE_SECRET)
    if (!isAllowedRedirect(state.redirect_uri, env.REDIRECT_URI_ALLOWLIST)) {
      return new Response('Invalid redirect_uri', { status: 400 })
    }
    const params = new URLSearchParams({ code })
    params.set('redirect_uri', `${url.origin}/api/github/callback`)
    const payload = await exchangeToken(params, env)
    const session = createCookieSession(payload)
    const encryptedSession = await encryptJson(session, env.STATE_SECRET)
    const maxAge = payload.refresh_token_expires_in ?? payload.expires_in
    const headers = new Headers({
      Location: state.redirect_uri,
      'Cache-Control': 'no-store',
    })
    headers.append('Set-Cookie', sessionCookie(env.COOKIE_NAME, encryptedSession, maxAge))
    return new Response(null, { status: 302, headers })
  } catch {
    return new Response('GitHub OAuth callback failed', { status: 400 })
  }
}

async function token(request: Request, env: Env): Promise<Response> {
  const encryptedSession = readCookie(request, env.COOKIE_NAME)
  if (!encryptedSession) return jsonResponse(request, env, { error: 'unauthenticated' }, 401)

  try {
    let session = await decryptJson<CookieSession>(encryptedSession, env.STATE_SECRET)
    const now = Date.now()
    let nextCookie: string | undefined
    if (session.expiresAt !== undefined && session.expiresAt <= now + 30_000) {
      if (!session.refreshToken || (
        session.refreshTokenExpiresAt !== undefined && session.refreshTokenExpiresAt <= now
      )) {
        return jsonResponse(request, env, { error: 'session_expired' }, 401)
      }
      const payload = await exchangeToken(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: session.refreshToken,
        }),
        env,
      )
      session = createCookieSession(payload, now)
      nextCookie = sessionCookie(
        env.COOKIE_NAME,
        await encryptJson(session, env.STATE_SECRET),
        payload.refresh_token_expires_in ?? payload.expires_in,
      )
    }

    return jsonResponse(
      request,
      env,
      {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        scopes: session.scopes,
      },
      200,
      {
        'Cache-Control': 'no-store',
        ...(nextCookie ? { 'Set-Cookie': nextCookie } : {}),
      },
    )
  } catch {
    return jsonResponse(
      request,
      env,
      { error: 'invalid_session' },
      401,
      { 'Set-Cookie': clearSessionCookie(env.COOKIE_NAME) },
    )
  }
}

function logout(request: Request, env: Env): Response {
  return jsonResponse(
    request,
    env,
    { ok: true },
    200,
    {
      'Cache-Control': 'no-store',
      'Set-Cookie': clearSessionCookie(env.COOKIE_NAME),
    },
  )
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return preflightResponse(request, env.FRONTEND_ORIGIN)

  if (url.pathname === '/api/github/login' && request.method === 'GET') {
    return login(request, env)
  }
  if (url.pathname === '/api/github/callback' && request.method === 'GET') {
    return callback(request, env)
  }
  if (url.pathname === '/api/github/token' && request.method === 'POST') {
    return token(request, env)
  }
  if (url.pathname === '/api/github/logout' && request.method === 'POST') {
    return logout(request, env)
  }
  return new Response('Not found', { status: 404 })
}

export default {
  fetch: handleRequest,
}
