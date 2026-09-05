import { it, expect } from 'vitest'
import { manifestPath, parseSourceKey, sourceKey } from './source'
it('keeps root identity compatible and preserves path case', () => {
  expect(sourceKey({ locator: 'github:Alice/Repo' })).toBe('github:alice/repo')
  expect(sourceKey({ locator: 'github:Alice/Repo', manifestPath: 'feeds/Gaming.yaml' })).toBe('github:alice/repo#feeds%2FGaming.yaml')
})
it('rejects unsafe or ambiguous repository paths', () => {
  for (const path of ['', '/root', '../root', 'a/../b', 'a//b', 'a/', 'a?b', 'a#b', 'a\\b']) expect(() => manifestPath(path)).toThrow()
  expect(() => sourceKey({ locator: 'github:a/b?ref=secret' })).toThrow()
})
it('round trips source keys and rejects unsafe encodings', () => {
  const key = sourceKey({
    locator: 'github:Alice/Repo',
    manifestPath: 'feeds/中文 feed.yaml',
  })
  expect(parseSourceKey(key)).toEqual({
    locator: 'github:alice/repo',
    manifestPath: 'feeds/中文 feed.yaml',
  })
  expect(parseSourceKey('github:Alice/Repo')).toEqual({
    locator: 'github:alice/repo',
  })
  for (const value of [
    'github:a/b#',
    'github:a/b#..%2Fsecret',
    'github:a/b#feeds%2Fa.yaml#other',
    'https:example.com/feed',
  ]) expect(() => parseSourceKey(value)).toThrow()
})
