import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Cloudflare deployment headers', () => {
  it('does not impose a CSP and preserves unrelated security headers', () => {
    const headers = readFileSync(
      new URL('../public/_headers', import.meta.url),
      'utf8',
    )
    expect(headers).not.toMatch(
      /content-security-policy(?:-report-only)?\s*:/iu,
    )
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain(
      'Referrer-Policy: strict-origin-when-cross-origin',
    )
    expect(headers).toContain('X-Frame-Options: DENY')
  })

  it('serves browser cache clearing headers only on the explicit reset endpoint', () => {
    const headers = readFileSync(
      new URL('../public/_headers', import.meta.url),
      'utf8',
    )
    expect(headers).toContain(
      '/clear-site-data.txt\n  Clear-Site-Data: "cache", "cookies"\n  X-Ahead-Reset: clear-cache-and-cookies\n  Cache-Control: no-store',
    )
    expect(headers.split('/clear-site-data.txt')[0]).not.toContain(
      'Clear-Site-Data',
    )
  })

  it('does not reintroduce a policy through HTML meta tags', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).not.toMatch(
      /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy/iu,
    )
  })
})
