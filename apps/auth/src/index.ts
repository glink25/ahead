import { corsHeaders, isAllowedOrigin, preflightResponse } from './cors.js'
import {
  decryptAuthorizationGrant,
  decryptState,
  encryptAuthorizationGrant,
  encryptState,
  type OAuthState,
  type PendingGitHubToken,
} from './state.js'

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

/** Short TTL for the initial OAuth round-trip. */
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000
/** Longer TTL so the user can finish App installation before Setup URL returns. */
const INSTALL_STATE_TTL_MS = 30 * 60 * 1000
/** Brief window for the initiating client to redeem the encrypted grant. */
const AUTHORIZATION_GRANT_TTL_MS = 2 * 60 * 1000
const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomVerifier(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
}

function isValidState(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value)
}

function isValidChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value)
}

function isValidVerifier(value: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/u.test(value)
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

function toPendingToken(payload: GitHubTokenPayload): PendingGitHubToken {
  return {
    access_token: payload.access_token!,
    ...(payload.refresh_token ? { refresh_token: payload.refresh_token } : {}),
    ...(payload.expires_in === undefined ? {} : { expires_in: payload.expires_in }),
    ...(payload.refresh_token_expires_in === undefined
      ? {}
      : { refresh_token_expires_in: payload.refresh_token_expires_in }),
    ...(payload.scope ? { scope: payload.scope } : {}),
    ...(payload.token_type ? { token_type: payload.token_type } : {}),
  }
}

async function redirectWithAuthorizationCode(
  state: OAuthState,
  payload: PendingGitHubToken,
  env: Env,
): Promise<Response> {
  const code = await encryptAuthorizationGrant({
    state: state.client_state,
    challenge: state.client_challenge,
    token: payload,
    exp: Date.now() + AUTHORIZATION_GRANT_TTL_MS,
  }, env.STATE_SECRET)
  const redirectUri = state.redirect_uri
  const location = new URL(redirectUri)
  location.searchParams.set('code', code)
  location.searchParams.set('state', state.client_state)
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

async function login(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url)
  const redirectUri = requestUrl.searchParams.get('redirect_uri')
  const clientState = requestUrl.searchParams.get('state')
  const clientChallenge = requestUrl.searchParams.get('code_challenge')
  if (!redirectUri || !isAllowedRedirect(redirectUri, env.REDIRECT_URI_ALLOWLIST)) {
    return new Response('Invalid redirect_uri', { status: 400 })
  }
  if (!clientState || !isValidState(clientState) || !clientChallenge || !isValidChallenge(clientChallenge)) {
    return new Response('Invalid state or code_challenge', { status: 400 })
  }
  if (!env.GITHUB_APP_SLUG) {
    return new Response('GITHUB_APP_SLUG is not configured', { status: 500 })
  }
  const githubVerifier = randomVerifier()
  const state = await encryptState(
    {
      redirect_uri: redirectUri,
      client_state: clientState,
      client_challenge: clientChallenge,
      github_verifier: githubVerifier,
      exp: Date.now() + OAUTH_STATE_TTL_MS,
    },
    env.STATE_SECRET,
  )
  const callbackUrl = `${requestUrl.origin}/api/github/callback`
  const githubUrl = new URL('https://github.com/login/oauth/authorize')
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  githubUrl.searchParams.set('redirect_uri', callbackUrl)
  githubUrl.searchParams.set('scope', 'repo')
  githubUrl.searchParams.set('state', state)
  githubUrl.searchParams.set('code_challenge', await pkceChallenge(githubVerifier))
  githubUrl.searchParams.set('code_challenge_method', 'S256')
  return new Response(null, {
    status: 302,
    headers: {
      Location: githubUrl.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

async function handleOAuthCodeCallback(
  requestUrl: URL,
  code: string,
  encryptedState: string,
  env: Env,
): Promise<Response> {
  const state = await decryptState(encryptedState, env.STATE_SECRET)
  if (!isAllowedRedirect(state.redirect_uri, env.REDIRECT_URI_ALLOWLIST)) {
    return new Response('Invalid redirect_uri', { status: 400 })
  }

  const params = new URLSearchParams({ code, code_verifier: state.github_verifier })
  params.set('redirect_uri', `${requestUrl.origin}/api/github/callback`)
  const payload = await exchangeToken(params, env)

  if (!(await hasAppInstallation(payload.access_token!, env))) {
    const installState = await encryptState(
      {
        redirect_uri: state.redirect_uri,
        client_state: state.client_state,
        client_challenge: state.client_challenge,
        github_verifier: state.github_verifier,
        exp: Date.now() + INSTALL_STATE_TTL_MS,
        pending_token: toPendingToken(payload),
      },
      env.STATE_SECRET,
    )
    const installUrl = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`)
    installUrl.searchParams.set('state', installState)
    return new Response(null, {
      status: 302,
      headers: {
        Location: installUrl.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  }

  return redirectWithAuthorizationCode(state, toPendingToken(payload), env)
}

async function handleSetupCallback(encryptedState: string, env: Env): Promise<Response> {
  const state = await decryptState(encryptedState, env.STATE_SECRET)
  if (!isAllowedRedirect(state.redirect_uri, env.REDIRECT_URI_ALLOWLIST)) {
    return new Response('Invalid redirect_uri', { status: 400 })
  }
  if (!state.pending_token?.access_token) {
    return new Response('Missing pending_token for installation return', { status: 400 })
  }
  if (!(await hasAppInstallation(state.pending_token.access_token, env))) {
    return new Response('GitHub App installation is required', { status: 400 })
  }
  return redirectWithAuthorizationCode(state, state.pending_token, env)
}

async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const encryptedState = url.searchParams.get('state')
  const installationId = url.searchParams.get('installation_id')
  const setupAction = url.searchParams.get('setup_action')

  if (!env.GITHUB_APP_SLUG) {
    return new Response('GITHUB_APP_SLUG is not configured', { status: 500 })
  }
  if (!encryptedState) {
    return new Response('Missing state', { status: 400 })
  }

  try {
    // App Setup URL return: installation_id + setup_action + state (no OAuth code).
    if (!code && installationId && setupAction) {
      return await handleSetupCallback(encryptedState, env)
    }
    if (!code) {
      return new Response('Missing code or state', { status: 400 })
    }
    return await handleOAuthCodeCallback(url, code, encryptedState, env)
  } catch {
    return new Response('GitHub OAuth callback failed', { status: 400 })
  }
}

async function exchangeAuthorizationCode(request: Request, env: Env): Promise<Response> {
  let body: { code?: string, state?: string, code_verifier?: string }
  try {
    body = await request.json() as { code?: string, state?: string, code_verifier?: string }
  } catch {
    return jsonResponse(request, env, { error: 'invalid_body' }, 400)
  }
  const code = body.code?.trim()
  const state = body.state?.trim()
  const verifier = body.code_verifier?.trim()
  if (!code || !state || !isValidState(state) || !verifier || !isValidVerifier(verifier)) {
    return jsonResponse(request, env, { error: 'invalid_exchange' }, 400, { 'Cache-Control': 'no-store' })
  }

  try {
    const grant = await decryptAuthorizationGrant(code, env.STATE_SECRET)
    if (grant.state !== state || await pkceChallenge(verifier) !== grant.challenge) {
      return jsonResponse(request, env, { error: 'invalid_exchange' }, 400, { 'Cache-Control': 'no-store' })
    }
    return jsonResponse(request, env, grant.token, 200, { 'Cache-Control': 'no-store' })
  } catch {
    return jsonResponse(request, env, { error: 'invalid_exchange' }, 400, { 'Cache-Control': 'no-store' })
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

function isAllowedSearchQuery(query: string): boolean {
  const eventSearch = /["']?oefSearch["']?/u.test(query) &&
    /["']?oef-search-v1["']?/u.test(query) && /\bin:file\b/u.test(query)
  const manifestSearch = /["']?event-feed["']?/u.test(query) &&
    /["']?oefVersion["']?/u.test(query) && /\brepo:[^\s/]+\/[^\s]+/u.test(query) &&
    /\bin:file\b/u.test(query)
  return eventSearch || manifestSearch
}

/** Narrow authenticated relay for GitHub Code Search responses lacking CORS. */
async function codeSearch(request: Request, env: Env): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get('Origin'), env.FRONTEND_ORIGIN))
    return new Response('Origin is not allowed', { status: 403, headers: { Vary: 'Origin' } })

  const authorization = request.headers.get('Authorization')?.trim()
  if (!authorization || !/^Bearer\s+\S+$/u.test(authorization))
    return jsonResponse(request, env, { message: 'A GitHub API token is required' }, 401, { 'Cache-Control': 'no-store' })

  const source = new URL(request.url)
  const query = source.searchParams.get('q')?.trim() ?? ''
  const page = Number(source.searchParams.get('page') ?? '1')
  const perPage = Number(source.searchParams.get('per_page') ?? '100')
  if (!query || query.length > 256 || !isAllowedSearchQuery(query) ||
    !Number.isInteger(page) || page < 1 || page > 10 ||
    !Number.isInteger(perPage) || perPage < 1 || perPage > 100)
    return jsonResponse(request, env, { message: 'Invalid Ahead search parameters' }, 400, { 'Cache-Control': 'no-store' })

  const target = new URL('https://api.github.com/search/code')
  target.searchParams.set('q', query)
  target.searchParams.set('page', String(page))
  target.searchParams.set('per_page', String(perPage))
  let response: Response
  try {
    response = await fetch(target, {
      redirect: 'manual',
      headers: {
        Authorization: authorization,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `${env.GITHUB_APP_SLUG} (Ahead Search Relay)`,
      },
    })
  } catch (error) {
    console.error(
      'GitHub code search request failed',
      error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error',
    )
    return jsonResponse(request, env, { message: 'GitHub code search is unreachable' }, 502, { 'Cache-Control': 'no-store' })
  }
  if (response.status >= 300 && response.status < 400) {
    console.error('GitHub code search returned an unexpected redirect', response.status)
    return jsonResponse(request, env, { message: 'GitHub code search is unreachable' }, 502, { 'Cache-Control': 'no-store' })
  }

  const headers = corsHeaders(request, env.FRONTEND_ORIGIN)
  headers.set('Content-Type', response.headers.get('Content-Type') ?? 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  for (const name of [
    'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-used',
    'x-ratelimit-resource', 'x-ratelimit-reset', 'retry-after',
  ]) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(await response.arrayBuffer(), { status: response.status, headers })
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
  if (url.pathname === '/api/github/exchange' && request.method === 'POST') {
    return exchangeAuthorizationCode(request, env)
  }
  if (url.pathname === '/api/github/refresh' && request.method === 'POST') {
    return refresh(request, env)
  }
  if (url.pathname === '/api/github/search/code' && request.method === 'GET') {
    return codeSearch(request, env)
  }
  return new Response('Not found', { status: 404 })
}

export default {
  fetch: handleRequest,
}
