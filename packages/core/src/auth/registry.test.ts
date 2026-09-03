import { describe, expect, it, vi } from 'vitest'
import { createAuthRegistry } from './registry.js'
import type { AuthProvider } from './types.js'

function provider(id: string, available: boolean): AuthProvider {
  return {
    id,
    kind: 'manual',
    available,
    authenticate: vi.fn(),
    restore: vi.fn(),
    getCredential: vi.fn(),
    logout: vi.fn(),
  }
}

describe('createAuthRegistry', () => {
  it('registers, retrieves, and lists providers in insertion order', () => {
    const pat = provider('github-pat', true)
    const oauth = provider('github-oauth', false)
    const registry = createAuthRegistry([pat]).register(oauth)

    expect(registry.get('github-pat')).toBe(pat)
    expect(registry.get('missing')).toBeUndefined()
    expect(registry.list()).toEqual([pat, oauth])
    expect(registry.available()).toEqual([pat])
  })

  it('replaces a provider registered with the same id', () => {
    const oldProvider = provider('github-pat', false)
    const newProvider = provider('github-pat', true)
    const registry = createAuthRegistry([oldProvider]).register(newProvider)

    expect(registry.list()).toEqual([newProvider])
    expect(registry.available()).toEqual([newProvider])
  })
})
