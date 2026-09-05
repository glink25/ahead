import { describe, expect, it, vi } from 'vitest'
import type { RepositoryAdapter } from '@ahead/core'
import { fetchFeed } from './feed-loader'
import { RepoCache } from './repo-cache'
import type { KeyValueStore } from './idb'
import { event, feed } from './test-fixtures'
const sha = 'a'.repeat(40)
const locator = { scheme: 'github', owner: 'a', repo: 'b' }
function memory(): KeyValueStore {
  const map = new Map<string, unknown>()
  return { update: async <T>(key: string, change: (v: T | undefined) => T) => { const next = change(map.get(key) as T | undefined); map.set(key, next); return next }, get: async <T>(key: string) => map.get(key) as T | undefined, set: async (key, value) => { map.set(key, value) }, delete: async (key) => { map.delete(key) }, keys: async () => [...map.keys()] }
}
function adapter(document: unknown): RepositoryAdapter {
  return {
    inspect: vi.fn(async () => ({ locator, headSha: sha, defaultBranch: 'trunk', private: false })),
    readFile: vi.fn(async (_locator, path) => ({ path, content: JSON.stringify(path.startsWith('events/') ? event('glob-event') : document), sha })),
    readTree: vi.fn(async () => [{ path: 'events/one.yaml', type: 'blob' as const, sha, mode: '100644' }]),
    commitFiles: vi.fn(), createRepository: vi.fn(),
  }
}
describe('repository feed loader', () => {
  it('pins content, distinguishes manifests and uses immutable cache', async () => {
    const api = adapter(feed())
    const cache = new RepoCache(memory())
    const options = { locator: 'github:a/b', manifestPath: 'feeds/games.yaml', adapter: api, cache }
    const loaded = await fetchFeed(options)
    expect(loaded.sourceLocator).toBe('github:a/b#feeds%2Fgames.yaml')
    expect(api.readFile).toHaveBeenCalledWith(locator, 'feeds/games.yaml', { ref: sha })
    await fetchFeed(options)
    expect(api.readFile).toHaveBeenCalledTimes(1)
    expect(await cache.readAny(loaded.sourceLocator, 'feeds/games.yaml')).toMatchObject({ headSha: sha })
  })
  it('expands glob alongside inline events, and supports default glob', async () => {
    const mixed = await fetchFeed({ locator: 'github:a/b', adapter: adapter({ ...feed(), eventsGlob: 'events/**/*.yaml' }) })
    expect(mixed.feed.events).toHaveLength(2)
    const document = feed()
    delete document.events
    const expanded = await fetchFeed({ locator: 'github:a/b', adapter: adapter(document) })
    expect(expanded.feed.events).toHaveLength(1)
  })
  it('rejects malformed feed and traversal', async () => {
    await expect(fetchFeed({ locator: 'github:a/b', adapter: adapter({}) })).rejects.toThrow()
    await expect(fetchFeed({ locator: 'github:a/b', manifestPath: '../token', adapter: adapter(feed()) })).rejects.toThrow('Invalid manifest path')
  })
})
it('refuses private repositories before reading or populating the public cache', async () => {
  const api = adapter(feed())
  vi.mocked(api.inspect).mockResolvedValue({ locator, headSha: sha, defaultBranch: 'main', private: true })
  const cache = new RepoCache(memory())
  await expect(fetchFeed({ locator: 'github:a/b', adapter: api, cache })).rejects.toThrow('messages.public_feeds_cannot_read_private_repositories')
  expect(api.readFile).not.toHaveBeenCalled()
  expect(await cache.readAny('github:a/b#ahead.yaml', 'ahead.yaml')).toBeUndefined()
})
