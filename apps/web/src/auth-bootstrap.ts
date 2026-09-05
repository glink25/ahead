import type { AuthProvider, AuthSession } from '@ahead/core'
import { describeOAuthError, GitHubOAuthError } from '@ahead/github'

export const OAUTH_RETURN_STORAGE_KEY = '_ahead_oauth_res'

export interface AuthBootstrapResult {
  session: AuthSession | null
  error: string | null
}

interface StoredOAuthReturn {
  url?: string
}

function readLegacyOAuthReturnUrl(): string | null {
  const raw = localStorage.getItem(OAUTH_RETURN_STORAGE_KEY)
  if (!raw) return null
  localStorage.removeItem(OAUTH_RETURN_STORAGE_KEY)
  try {
    const parsed = JSON.parse(raw) as StoredOAuthReturn | string
    if (typeof parsed === 'string') return parsed
    return parsed.url ?? null
  } catch {
    return raw.includes('github_authorized=') ? raw : null
  }
}

/** Prefer the live URL; fall back to the legacy localStorage stash. */
export function resolveOAuthReturnUrl(
  href = globalThis.location?.href ?? '',
): string | null {
  if (href.includes('github_authorized=')) return href
  return readLegacyOAuthReturnUrl()
}

export function clearOAuthReturnParams(href = globalThis.location?.href ?? ''): void {
  if (!href.includes('github_authorized=') || !globalThis.history?.replaceState) return
  const cleaned = new URL(href)
  cleaned.searchParams.delete('github_authorized')
  const next = `${cleaned.pathname}${cleaned.search}${cleaned.hash}`
  globalThis.history.replaceState(null, '', next)
}

export async function bootstrapAuthSession(options: {
  patProvider: AuthProvider
  oauthProvider: AuthProvider & {
    consumeRedirect: (url: string) => Promise<AuthSession | null>
  }
}): Promise<AuthBootstrapResult> {
  const pendingUrl = resolveOAuthReturnUrl()
  if (pendingUrl) {
    try {
      const session = await options.oauthProvider.consumeRedirect(pendingUrl)
      clearOAuthReturnParams(pendingUrl)
      if (session) return { session, error: null }
    } catch (error) {
      clearOAuthReturnParams(pendingUrl)
      return {
        session: null,
        error: describeOAuthError(error),
      }
    }
  }

  const [patResult, oauthResult] = await Promise.allSettled([
    options.patProvider.restore(),
    options.oauthProvider.restore(),
  ])
  const pat = patResult.status === 'fulfilled' ? patResult.value : null
  if (oauthResult.status === 'fulfilled') {
    return { session: oauthResult.value ?? pat, error: patResult.status === 'rejected' && !oauthResult.value ? 'messages.cannot_verify_sign_in_connect_to_the_internet_and_retry' : null }
  }
  if (oauthResult.reason instanceof GitHubOAuthError && oauthResult.reason.kind === 'network') {
    return { session: pat, error: describeOAuthError(oauthResult.reason) }
  }
  return { session: pat, error: null }
}
