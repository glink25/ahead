import { afterEach, describe, expect, it, vi } from 'vitest'
import { isExpired, toExpiresAt } from './expires.js'

describe('token expiry helpers', () => {
  afterEach(() => vi.useRealTimers())

  it('converts a duration in seconds to epoch milliseconds', () => {
    expect(toExpiresAt(90, 1_000)).toBe(91_000)
  })

  it('treats tokens inside the clock skew window as expired', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    expect(isExpired(1_059_999)).toBe(true)
    expect(isExpired(1_060_001)).toBe(false)
    expect(isExpired(1_000_001, 0)).toBe(false)
  })
})
