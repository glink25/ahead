import { describe, expect, it } from 'vitest'
import { createCacheKey, MemoryCache } from './cache.js'

const locator = { scheme: 'github', owner: 'Ahead', repo: 'Events' }

describe('MemoryCache', () => {
  it('keys entries by locator, commit SHA, and path', () => {
    const cache = new MemoryCache<string>()
    cache.set(locator, 'sha-1', 'ahead.yaml', 'first')
    cache.set(locator, 'sha-2', 'ahead.yaml', 'second')

    expect(cache.get(locator, 'sha-1', 'ahead.yaml')).toBe('first')
    expect(cache.get(locator, 'sha-2', 'ahead.yaml')).toBe('second')
    expect(cache.get(locator, 'sha-1', 'other.yaml')).toBeUndefined()
  })

  it('normalizes owner and repository casing', () => {
    expect(createCacheKey(locator, 'abc', '/feed/a.yaml')).toBe(
      createCacheKey({ scheme: 'github', owner: 'ahead', repo: 'events' }, 'abc', 'feed/a.yaml'),
    )
  })
})
