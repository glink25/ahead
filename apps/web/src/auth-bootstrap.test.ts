import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearOAuthReturnParams,
  OAUTH_RETURN_STORAGE_KEY,
  resolveOAuthReturnUrl,
} from './auth-bootstrap'

function memoryLocalStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
}

describe('resolveOAuthReturnUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers github_authorized in the current href', () => {
    vi.stubGlobal('localStorage', memoryLocalStorage())
    const href = 'http://localhost:4455/login?github_authorized=%7B%22access_token%22%3A%22x%22%7D'
    expect(resolveOAuthReturnUrl(href)).toBe(href)
  })

  it('falls back to legacy localStorage stash', () => {
    const storage = memoryLocalStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem(
      OAUTH_RETURN_STORAGE_KEY,
      JSON.stringify({ url: 'http://localhost:4455/login?github_authorized=legacy' }),
    )
    expect(resolveOAuthReturnUrl('http://localhost:4455/login')).toBe(
      'http://localhost:4455/login?github_authorized=legacy',
    )
    expect(storage.getItem(OAUTH_RETURN_STORAGE_KEY)).toBeNull()
  })
})

describe('clearOAuthReturnParams', () => {
  it('strips github_authorized via history.replaceState', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('history', { replaceState })
    clearOAuthReturnParams('http://localhost:4455/login?github_authorized=abc&x=1')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/login?x=1')
  })
})
