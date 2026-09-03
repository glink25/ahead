import { describe, expect, it } from 'vitest'
import { isCredentialExpired, resolveExpiresAt } from './oauth-provider.js'

describe('OAuth credential expiry', () => {
  it('converts expires_in seconds to epoch milliseconds', () => {
    expect(resolveExpiresAt({ expires_in: 3600 }, 1_000)).toBe(3_601_000)
  })

  it('normalizes epoch seconds while preserving epoch milliseconds', () => {
    expect(resolveExpiresAt({ expires_at: 2_000_000_000 })).toBe(2_000_000_000_000)
    expect(resolveExpiresAt({ expiresAt: 2_000_000_000_000 })).toBe(2_000_000_000_000)
  })

  it('treats credentials within the refresh skew as expired', () => {
    expect(isCredentialExpired(131_000, 100_000)).toBe(false)
    expect(isCredentialExpired(130_000, 100_000)).toBe(true)
    expect(isCredentialExpired(undefined, 100_000)).toBe(false)
  })
})
