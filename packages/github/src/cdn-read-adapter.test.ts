import { describe, expect, it, vi } from 'vitest'
import {
  buildJsDelivrUrl,
  buildRawGitHubUrl,
  CdnReadAdapter,
} from './adapters/cdn-read-adapter.js'

const locator = { scheme: 'github', owner: 'ahead-org', repo: 'events' }

describe('CDN read adapter', () => {
  it('builds immutable, path-safe URLs', () => {
    expect(buildJsDelivrUrl(locator, 'abc123', 'feeds/中文 feed.yaml')).toBe(
      'https://cdn.jsdelivr.net/gh/ahead-org/events@abc123/feeds/%E4%B8%AD%E6%96%87%20feed.yaml',
    )
    expect(buildRawGitHubUrl(locator, 'abc123', 'feeds/a.yaml')).toBe(
      'https://raw.githubusercontent.com/ahead-org/events/abc123/feeds/a.yaml',
    )
  })

  it('falls back from jsDelivr to raw GitHub', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' })))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('content'))
    const adapter = new CdnReadAdapter(fetcher)

    await expect(adapter.readFile(locator, 'ahead.yaml')).resolves.toMatchObject({
      content: 'content',
      sha: 'abc123',
    })
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://raw.githubusercontent.com/ahead-org/events/abc123/ahead.yaml',
    )
  })
})
