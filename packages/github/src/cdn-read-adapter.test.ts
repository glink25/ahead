import { describe, expect, it, vi } from 'vitest'
import {
  buildJsDelivrUrl,
  buildRawGitHubUrl,
  CdnReadAdapter,
} from './adapters/cdn-read-adapter.js'

const locator = { scheme: 'github', owner: 'ahead-org', repo: 'events' }

describe('CDN read adapter', () => {
  it('shares repository inspection and never resolves an already pinned SHA', async () => {
    const sha = 'a'.repeat(40)
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ default_branch: 'trunk', private: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha })))
      .mockResolvedValueOnce(new Response('feed'))
    const adapter = new CdnReadAdapter(fetcher)
    const snapshots = await Promise.all([adapter.inspect(locator), adapter.inspect(locator)])
    expect(snapshots[0]).toEqual(snapshots[1])
    expect(fetcher).toHaveBeenCalledTimes(2)
    await adapter.readFile(locator, 'feeds/games.yaml', { ref: sha })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[2]?.[0]).toContain('@' + sha)
  })
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
