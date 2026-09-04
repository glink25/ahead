/** Authenticate GitHub metadata only; CDN and raw content never receive tokens. */
export function createPublicFetch(getAccessToken?: () => Promise<string>): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (url.origin === 'https://api.github.com' && getAccessToken) {
      headers.set('Authorization', 'Bearer ' + await getAccessToken())
    }
    return globalThis.fetch(input, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(15000) })
  }
}
