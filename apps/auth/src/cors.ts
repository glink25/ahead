function parseOriginAllowlist(allowlist: string): string[] {
  return allowlist
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function isAllowedOrigin(origin: string | null, allowlist: string): boolean {
  if (!origin) return false
  return parseOriginAllowlist(allowlist).includes(origin)
}

export function corsHeaders(request: Request, frontendOrigin: string): Headers {
  const headers = new Headers({ Vary: 'Origin' })
  const origin = request.headers.get('Origin')
  if (isAllowedOrigin(origin, frontendOrigin)) {
    headers.set('Access-Control-Allow-Origin', origin!)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
  return headers
}

export function preflightResponse(request: Request, frontendOrigin: string): Response {
  const origin = request.headers.get('Origin')
  if (origin && !isAllowedOrigin(origin, frontendOrigin)) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } })
  }
  return new Response(null, { status: 204, headers: corsHeaders(request, frontendOrigin) })
}
