import { describe, expect, it } from 'vitest'
import { feed } from './test-fixtures'
import { memory } from '../services/test-helpers'
import { RepoCache } from './repo-cache'

describe('RepoCache retention', () => {
  it('keeps only the current and previous commit for a manifest', async () => {
    const cache = new RepoCache(memory())
    const base = { sourceLocator: 'github:a/feed', manifestPath: 'ahead.yaml', feed: feed() }
    await cache.write({ ...base, headSha: '1'.repeat(40) })
    await cache.write({ ...base, headSha: '2'.repeat(40) })
    await cache.write({ ...base, headSha: '3'.repeat(40) })
    expect(await cache.read(base.sourceLocator, base.manifestPath, '1'.repeat(40))).toBeUndefined()
    expect(await cache.read(base.sourceLocator, base.manifestPath, '2'.repeat(40))).toBeDefined()
    expect(await cache.read(base.sourceLocator, base.manifestPath, '3'.repeat(40))).toBeDefined()
  })
})
