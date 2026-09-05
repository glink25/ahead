import { afterEach, expect, it, vi } from 'vitest'
import { OctokitAdapter } from './adapters/octokit-adapter.js'

afterEach(() => vi.restoreAllMocks())

it('uses the authenticated Octokit transport for code search', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    expect(url.pathname).toBe('/search/code')
    expect(url.searchParams.get('q')).toBe('games title schedule in:file')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token')
    return new Response(JSON.stringify({
      total_count: 1,
      incomplete_results: false,
      items: [{
        path: 'events/game.yaml',
        repository: { name: 'events', owner: { login: 'alice' } },
      }],
    }), { headers: { 'content-type': 'application/json' } })
  })
  const result = await new OctokitAdapter(async () => 'token')
    .searchCode('games title schedule in:file', 1, 100)
  expect(result).toEqual({
    total_count: 1,
    incomplete_results: false,
    items: [{
      path: 'events/game.yaml',
      repository: { name: 'events', owner: { login: 'alice' } },
    }],
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
