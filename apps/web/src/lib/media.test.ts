import { it, expect } from 'vitest'
import { posterFor } from './media'
import { event } from './test-fixtures'
it('uses repository-root media with commit pinning, rejects unsafe URLs, honors privacy', () => {
  const source = { ...event(), media: [{ path: 'assets/poster.webp' }] }
  expect(posterFor(source, { locator: { scheme: 'github', owner: 'a', repo: 'b' }, headSha: 'a'.repeat(40) }).url)
    .toBe('https://cdn.jsdelivr.net/gh/a/b@' + 'a'.repeat(40) + '/assets/poster.webp')
  expect(posterFor({ ...source, media: [{ path: 'javascript:alert(1)' }] }).url).toBeUndefined()
  const hidden = posterFor({ ...source, media: [{ path: 'https://example.com/a.webp' }] }, { allowRemoteImages: false })
  expect(hidden.suppressed).toBe(true)
  expect(hidden.url).toBeUndefined()
})
