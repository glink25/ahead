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

function readPendingOAuthReturnUrl(): string | null {
  const raw = localStorage.getItem(OAUTH_RETURN_STORAGE_KEY)
  if (!raw) return null
  localStorage.removeItem(OAUTH_RETURN_STORAGE_KEY)
  try {
    const parsed = JSON.parse(raw) as StoredOAuthReturn | string
    if (typeof parsed === 'string') return parsed
    return parsed.url ?? null
  } catch {
    // Legacy plain URL string (if any) or corrupt JSON — try treating as href.
    return raw.includes('github_authorized=') ? raw : null
  }
}

export async function bootstrapAuthSession(options: {
  patProvider: AuthProvider
  oauthProvider: AuthProvider & {
    consumeRedirect: (url: string) => Promise<AuthSession | null>
  }
}): Promise<AuthBootstrapResult> {
  const pendingUrl = readPendingOAuthReturnUrl()
  if (pendingUrl) {
    try {
      const session = await options.oauthProvider.consumeRedirect(pendingUrl)
      if (session) return { session, error: null }
    } catch (error) {
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
    return { session: oauthResult.value ?? pat, error: null }
  }
  if (oauthResult.reason instanceof GitHubOAuthError && oauthResult.reason.kind === 'network') {
    return { session: pat, error: describeOAuthError(oauthResult.reason) }
  }
  return { session: pat, error: null }
}
