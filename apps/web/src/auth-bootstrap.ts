import type { AuthProvider, AuthSession } from '@ahead/core'
import { describeOAuthError, GitHubOAuthError } from '@ahead/github'

export interface AuthBootstrapResult {
  session: AuthSession | null
  error: string | null
}

function resolveOAuthReturnUrl(
  href = globalThis.location?.href ?? '',
): string | null {
  if (!href) return null
  const url = new URL(href)
  return url.searchParams.has('code') && url.searchParams.has('state') ? href : null
}

function clearOAuthReturnParams(href = globalThis.location?.href ?? ''): void {
  if (!href || !globalThis.history?.replaceState) return
  const cleaned = new URL(href)
  if (!cleaned.searchParams.has('code') && !cleaned.searchParams.has('state')) return
  cleaned.searchParams.delete('code')
  cleaned.searchParams.delete('state')
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
      if (!(error instanceof GitHubOAuthError) ||
        (error.kind !== 'network' && error.kind !== 'http')) clearOAuthReturnParams(pendingUrl)
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
