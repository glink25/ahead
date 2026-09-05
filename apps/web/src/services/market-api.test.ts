import { expect, it, vi } from 'vitest'
import { serializeSourceBlock } from '@ahead/market'
import { MarketApi, type MarketEvent } from './market-api'
import { PublicReadClient } from './public-read-client'
import { RepoCache } from '../lib/repo-cache'
import { feed } from '../lib/test-fixtures'
import { memory, deferred } from './test-helpers'
import type { RepositoryAdapter } from '@ahead/core'
const sha = 'a'.repeat(40)
const issue = (number: number) => ({
  number,
  title: 'feed' + number,
  html_url: 'https://github.com/a/b/issues/' + number,
  labels: [{ name: 'approved' }],
  body: serializeSourceBlock({
    schema: 1,
    locator: 'github:a/r' + number,
    manifestPath: 'ahead.yaml',
    resourceType: 'event-feed',
  }),
})
function setup(fetcher: typeof fetch) {
  return new MarketApi({
    repository: 'a/market',
    client: new PublicReadClient({
      fetcher,
      store: memory(),
      authenticated: true,
      apiInterval: 0,
    }),
    storage: memory(),
    cache: new RepoCache(memory()),
  })
}
function searchSetup(files: Record<string, unknown>, searchFetcher?: typeof fetch) {
  const adapter: RepositoryAdapter = {
    inspect: async (locator) => ({
      locator,
      defaultBranch: 'main',
      headSha: sha,
      private: false,
    }),
    readFile: async (_locator, path) => {
      if (!(path in files)) throw new Error('missing ' + path)
      return { path, content: JSON.stringify(files[path]), sha, encoding: 'utf-8' }
    },
    readTree: async () => Object.keys(files).map((path) => ({
      path,
      type: 'blob' as const,
      mode: '100644',
      sha,
    })),
    commitFiles: async () => { throw new Error('read only') },
    createRepository: async () => { throw new Error('read only') },
  }
  return new MarketApi({
    repository: 'a/market',
    client: new PublicReadClient({ fetcher: async () => new Response('{}'), store: memory(), authenticated: true, apiInterval: 0 }),
    storage: memory(),
    cache: new RepoCache(memory()),
    privateAdapter: adapter,
    ...(searchFetcher ? { searchFetcher } : {}),
  })
}
function response(input: RequestInfo | URL) {
  const url = String(input)
  if (url.includes('/commits/')) return new Response(JSON.stringify({ sha }))
  if (url.includes('api.github.com/repos/'))
    return new Response(
      JSON.stringify({ private: false, default_branch: 'main' }),
    )
  return new Response(JSON.stringify(feed()))
}
it('delivers the first source while a sibling is slow and before requesting the next page', async () => {
  const slow = deferred<Response>(),
    events: MarketEvent[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/issues?'))
      return new Response(
        JSON.stringify(
          new URL(url).searchParams.get('page') === '2'
            ? [issue(3)]
            : [issue(1), issue(2)],
        ),
        {
          headers:
            new URL(url).searchParams.get('page') === '2'
              ? {}
              : { link: '<next>; rel="next"' },
        },
      )
    if (url.includes('/r2@')) return slow.promise
    return response(input)
  })
  const stream = setup(fetcher).market.stream()
  for await (const event of stream) {
    events.push(event)
    if (event.type === 'feed' && !event.cached) {
      expect(
        fetcher.mock.calls.some(
          ([url]) => new URL(String(url)).searchParams.get('page') === '2',
        ),
      ).toBe(false)
      slow.resolve(response('cdn'))
      break
    }
  }
  expect(events.some((event) => event.type === 'feed')).toBe(true)
})
it('resumes interrupted sources without losing content and deduplicates across pages', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/issues?'))
      return new Response(
        JSON.stringify(
          new URL(String(input)).searchParams.get('page') === '2'
            ? [issue(1), issue(3)]
            : [issue(1), issue(2)],
        ),
        {
          headers:
            new URL(String(input)).searchParams.get('page') === '2'
              ? {}
              : { link: '<next>; rel="next"' },
        },
      )
    return response(input)
  })
  const api = setup(fetcher)
  let cursor: string | undefined
  const received = new Set<string>()
  for await (const event of api.market.stream({ signal: controller.signal })) {
    if (event.type === 'progress') cursor = event.cursor
    if (event.type === 'feed') {
      received.add(event.feed.sourceLocator)
      controller.abort()
    }
  }
  const events: MarketEvent[] = []
  for await (const event of api.market.stream({ cursor })) {
    events.push(event)
    if (event.type === 'feed') received.add(event.feed.sourceLocator)
  }
  expect(received.size).toBe(3)
  expect(events.at(-1)).toMatchObject({
    type: 'progress',
    complete: true,
    loaded: 3,
  })
})
it('retries a failed page without restarting and continues after an individual source error', async () => {
  let failed = false
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/issues?')) {
      if (new URL(url).searchParams.get('page') === '2' && !failed) {
        failed = true
        return new Response('outage', { status: 503 })
      }
      return new Response(
        JSON.stringify(
          new URL(url).searchParams.get('page') === '2'
            ? [issue(2)]
            : [issue(1)],
        ),
        {
          headers:
            new URL(url).searchParams.get('page') === '2'
              ? {}
              : { link: '<next>; rel="next"' },
        },
      )
    }
    if (url.endsWith('/repos/a/r1'))
      return new Response('denied', { status: 403 })
    return response(input)
  })
  const api = setup(fetcher)
  let cursor: string | undefined
  const errors: MarketEvent[] = []
  for await (const event of api.market.stream()) {
    if (event.type === 'progress') cursor = event.cursor
    if (event.type === 'error') errors.push(event)
  }
  expect(errors).toHaveLength(2)
  const resumed: MarketEvent[] = []
  for await (const event of api.market.stream({ cursor })) resumed.push(event)
  expect(resumed.some((event) => event.type === 'feed')).toBe(true)
  expect(resumed.at(-1)).toMatchObject({ complete: true })
  expect(
    fetcher.mock.calls.filter(
      ([url]) =>
        String(url).includes('/issues?') &&
        new URL(String(url)).searchParams.get('page') === '1',
    ),
  ).toHaveLength(1)
})
it('keeps a larger traversal bounded to three source readers and consumes one page at a time', async () => {
  let active = 0,
    max = 0,
    finished = 0,
    pages = 0
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/issues')) {
      const page = Number(url.searchParams.get('page'))
      pages++
      expect(finished).toBe((page - 1) * 20)
      return new Response(
        JSON.stringify(
          Array.from({ length: 20 }, (_, i) => issue((page - 1) * 20 + i + 1)),
        ),
        { headers: page < 4 ? { link: '<next>; rel="next"' } : {} },
      )
    }
    if (url.origin === 'https://cdn.jsdelivr.net') {
      active++
      max = Math.max(max, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      finished++
    }
    return response(input)
  })
  let last: MarketEvent | undefined
  for await (const event of setup(fetcher).market.stream()) last = event
  expect(pages).toBe(4)
  expect(max).toBeLessThanOrEqual(3)
  expect(last).toMatchObject({ complete: true, loaded: 80 })
})

it('searches an inline feed and filters its events in the API layer', async () => {
  const source = feed([
    { ...feed().events![0]!, id: 'match', title: { en: 'Game release' }, tags: ['games'] },
    { ...feed().events![0]!, id: 'other', title: { en: 'Concert' } },
  ])
  const searchFetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
    total_count: 1,
    incomplete_results: false,
    items: [{ path: 'custom/feed.json', repository: { name: 'repo', owner: { login: 'alice' } } }],
  })))
  const events = []
  for await (const event of searchSetup({ 'custom/feed.json': source }, searchFetcher).search.stream({ query: 'game' })) events.push(event)
  expect(events.find((event) => event.type === 'feed')).toMatchObject({
    feed: { manifestPath: 'custom/feed.json', feed: { events: [{ id: 'match' }] } },
  })
  expect(events.at(-1)).toMatchObject({ type: 'progress', complete: true })
  expect(decodeURIComponent(new URL(String(searchFetcher.mock.calls[0]![0])).searchParams.get('q')!)).toContain('"game"')
})

it('maps a standalone event to an arbitrary eventsGlob manifest for tag search', async () => {
  const event = { ...feed().events![0]!, id: 'game', title: { en: 'Launch' }, tags: ['games'] }
  const manifest = { ...feed([]), eventsGlob: 'content/*.json' }
  const searchFetcher = vi.fn(async (input: RequestInfo | URL) => {
    const query = decodeURIComponent(new URL(String(input)).searchParams.get('q')!)
    return new Response(JSON.stringify({
      total_count: 1,
      incomplete_results: false,
      items: query.includes('repo:alice/repo')
        ? [{ path: 'feeds/ahead.json', repository: { name: 'repo', owner: { login: 'alice' } } }]
        : [{ path: 'content/game.json', repository: { name: 'repo', owner: { login: 'alice' } } }],
    }))
  })
  const events = []
  for await (const item of searchSetup({
    'content/game.json': event,
    'feeds/ahead.json': manifest,
  }, searchFetcher).search.stream({ tag: 'games' })) events.push(item)
  expect(events.find((item) => item.type === 'feed')).toMatchObject({
    feed: { manifestPath: 'feeds/ahead.json', feed: { events: [{ id: 'game' }] } },
  })
  expect(searchFetcher).toHaveBeenCalledTimes(2)
})

it('reports that GitHub authentication is required before searching', async () => {
  const events = []
  for await (const event of searchSetup({}).search.stream({ query: 'game' })) events.push(event)
  expect(events).toEqual([
    expect.objectContaining({ type: 'error', reason: 'authentication-required' }),
  ])
})
