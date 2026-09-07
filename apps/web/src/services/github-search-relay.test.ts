import { expect, it, vi } from 'vitest'
import { createGitHubSearchRelay } from './github-search-relay'

it('sends the local GitHub token only to the configured search relay', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
    total_count: 1,
    incomplete_results: false,
    items: [{
      path: 'events/launch.yaml',
      repository: { name: 'calendar', owner: { login: 'alice' } },
    }],
  })))
  const relay = createGitHubSearchRelay({
    baseUrl: 'https://auth.example/',
    getAccessToken: async () => 'ghu_local_token',
    fetcher,
  })
  await expect(relay.searchCode('"launch" "oefSearch" "oef-search-v1" in:file', 2, 50))
    .resolves.toMatchObject({ total_count: 1 })
  const [input, init] = fetcher.mock.calls[0]!
  const url = new URL(String(input))
  expect(url.origin + url.pathname).toBe('https://auth.example/api/github/search/code')
  expect(url.searchParams.get('page')).toBe('2')
  expect(url.searchParams.get('per_page')).toBe('50')
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ghu_local_token')
})

it('requires relay configuration and rejects malformed relay responses', async () => {
  const unconfigured = createGitHubSearchRelay({
    baseUrl: '',
    getAccessToken: async () => 'ghu_token',
  })
  await expect(unconfigured.searchCode('query')).rejects.toThrow('not configured')

  const malformed = createGitHubSearchRelay({
    baseUrl: 'https://auth.example',
    getAccessToken: async () => 'ghu_token',
    fetcher: async () => new Response('{}'),
  })
  await expect(malformed.searchCode('query')).rejects.toMatchObject({ status: 502 })
})
