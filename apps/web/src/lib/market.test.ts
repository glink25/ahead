import { it, expect, vi } from 'vitest'
import { serializeSourceBlock } from '@ahead/market'
import { loadMarketListings } from './market'
it('paginates, deduplicates by manifest, ignores pull requests and unapproved entries', async () => {
  const issue = (number: number, path: string) => ({
    number, title: path, html_url: 'https://github.com/a/b/issues/' + number, labels: [{ name: 'approved' }],
    body: serializeSourceBlock({ schema: 1, locator: 'github:a/b', manifestPath: path, resourceType: 'event-feed' }),
  })
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([
    issue(1, 'feeds/a.yaml'), { ...issue(2, 'feeds/b.yaml'), pull_request: {} },
  ]), { headers: { link: '<https://api.github.com/next>; rel="next"' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify([issue(3, 'feeds/b.yaml'), issue(4, 'feeds/a.yaml'), { ...issue(5, 'other.yaml'), labels: [] }])))
  const list = await loadMarketListings({ repository: 'a/market', fetcher })
  expect(list.map((l) => l.issueNumber)).toEqual([1, 3])
  expect(fetcher.mock.calls[1]?.[0]).toContain('page=2')
  expect(list[0]?.manifest).toBeUndefined()
})
