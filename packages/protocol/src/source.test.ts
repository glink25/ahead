import { it, expect } from 'vitest'
import { manifestPath, sourceKey } from './source'
it('keeps root identity compatible and preserves path case', () => {
  expect(sourceKey({ locator: 'github:Alice/Repo' })).toBe('github:alice/repo')
  expect(sourceKey({ locator: 'github:Alice/Repo', manifestPath: 'feeds/Gaming.yaml' })).toBe('github:alice/repo#feeds%2FGaming.yaml')
})
it('rejects unsafe or ambiguous repository paths', () => {
  for (const path of ['', '/root', '../root', 'a/../b', 'a//b', 'a/', 'a?b', 'a#b', 'a\\b']) expect(() => manifestPath(path)).toThrow()
  expect(() => sourceKey({ locator: 'github:a/b?ref=secret' })).toThrow()
})
