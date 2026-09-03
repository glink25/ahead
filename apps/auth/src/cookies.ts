export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const item of header.split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(item.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

export function sessionCookie(name: string, value: string, maxAge?: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/api/github',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    ...(maxAge === undefined ? [] : [`Max-Age=${Math.max(0, Math.floor(maxAge))}`]),
  ].join('; ')
}

export function clearSessionCookie(name: string): string {
  return sessionCookie(name, '', 0)
}
