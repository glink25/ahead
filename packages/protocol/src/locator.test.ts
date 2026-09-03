import { describe, expect, it } from 'vitest'
import { parseLocator, registerScheme, serialize } from './locator.js'

describe('resource locators', () => {
  it('parses and serializes a GitHub locator', () => {
    const parsed = parseLocator('github:owner/repo')

    expect(parsed).toEqual({ scheme: 'github', owner: 'owner', repo: 'repo' })
    expect(serialize(parsed)).toBe('github:owner/repo')
  })

  it('supports extension schemes', () => {
    registerScheme('memory', {
      parse: (reference) => ({ reference }),
      serialize: (locator) => ('reference' in locator ? locator.reference : ''),
    })

    expect(parseLocator('memory:item-1')).toEqual({ scheme: 'memory', reference: 'item-1' })
  })

  it('rejects malformed GitHub locators', () => {
    expect(() => parseLocator('github:owner')).toThrow(TypeError)
  })
})
