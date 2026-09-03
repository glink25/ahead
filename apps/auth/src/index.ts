import { corsHeaders, preflightResponse } from './cors.js'
import { decryptState, encryptState } from './state.js'

export interface Env {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GITHUB_APP_SLUG: string
  STATE_SECRET: string
  REDIRECT_URI_ALLOWLIST: string
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

interface InstallationsResponse {
  total_count: number
  installations: unknown[]
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

export function isAllowedRedirect(value: string, allowlist: string): boolean {
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

async function hasAppInstallation(accessToken: string, env: Env): Promise<boolean> {
  const response = await fetch('https://api.github.com/user/installations', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': `${env.GITHUB_APP_SLUG} (Ahead Auth Worker)`,
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub installations lookup failed with HTTP ${response.status}`)
  }
  const body = await response.json() as InstallationsResponse
  return body.total_count > 0 && Array.isArray(body.installations) && body.installations.length > 0
}

function redirectWithAuthorizedToken(redirectUri: string, payload: GitHubTokenPayload): Response {
  const location = new URL(redirectUri)
  location.searchParams.set('github_authorized', JSON.stringify(payload))
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      'Cache-Control': 'no-store',
    },
  })
}

async function login(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url)
  const redirectUri = requestUrl.searchParams.get('redirect_uri')
  if (!redirectUri || !isAllowedRedirect(redirectUri, env.REDIRECT_URI_ALLOWLIST)) {
    return new Response('Invalid redirect_uri', { status: 400 })
  }
  if (!env.GITHUB_APP_SLUG) {
    return new Response('GITHUB_APP_SLUG is not configured', { status: 500 })
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
  if (!env.GITHUB_APP_SLUG) {
    return new Response('GITHUB_APP_SLUG is not configured', { status: 500 })
  }

  try {
    const state = await decryptState(encryptedState, env.STATE_SECRET)
    if (!isAllowedRedirect(state.redirect_uri, env.REDIRECT_URI_ALLOWLIST)) {
      return new Response('Invalid redirect_uri', { status: 400 })
    }
    const params = new URLSearchParams({ code })
    params.set('redirect_uri', `${url.origin}/api/github/callback`)
    const payload = await exchangeToken(params, env)

    if (!(await hasAppInstallation(payload.access_token!, env))) {
      const installUrl = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`)
      installUrl.searchParams.set('state', encryptedState)
      return new Response(null, {
        status: 302,
        headers: {
          Location: installUrl.toString(),
          'Cache-Control': 'no-store',
        },
      })
    }

    return redirectWithAuthorizedToken(state.redirect_uri, payload)
  } catch {
    return new Response('GitHub OAuth callback failed', { status: 400 })
  }
}

async function refresh(request: Request, env: Env): Promise<Response> {
  let body: { refreshToken?: string }
  try {
    body = await request.json() as { refreshToken?: string }
  } catch {
    return jsonResponse(request, env, { error: 'invalid_body' }, 400)
  }
  const refreshToken = body.refreshToken?.trim()
  if (!refreshToken) {
    return jsonResponse(request, env, { error: 'invalid_refresh_token' }, 400)
  }

  try {
    const payload = await exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      env,
    )
    return jsonResponse(request, env, payload, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    return jsonResponse(
      request,
      env,
      { error: 'refresh_failed', message: error instanceof Error ? error.message : 'refresh failed' },
      401,
    )
  }
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
  if (url.pathname === '/api/github/refresh' && request.method === 'POST') {
    return refresh(request, env)
  }
  return new Response('Not found', { status: 404 })
}

export default {
  fetch: handleRequest,
}
