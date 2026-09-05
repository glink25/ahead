import { afterEach, expect, it, vi } from 'vitest'
import {
  PublicReadClient,
  READ_POLICY,
} from './public-read-client'
import { memory, deferred } from './test-helpers'
const url = 'https://api.github.com/repos/a/b'
afterEach(() => vi.useRealTimers())
it('coalesces readers, persists responses, validates ETags and keeps pagination headers on 304', async () => {
  let now = 1000
  const gate = deferred<Response>(),
    store = memory()
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(gate.promise)
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
  const client = new PublicReadClient({
    fetcher,
    store,
    authenticated: true,
    apiInterval: 0,
    now: () => now,
  })
  const read = client.fetch()
  const first = read(url),
    second = read(url)
  gate.resolve(
    new Response('hello', {
      headers: { etag: 'one', link: '<next>; rel="next"' },
    }),
  )
  expect(await (await first).text()).toBe('hello')
  expect(await (await second).text()).toBe('hello')
  expect(fetcher).toHaveBeenCalledTimes(1)
  now += READ_POLICY.ttl + 1
  const validated = await read(url)
  expect(validated.status).toBe(200)
  expect(validated.headers.get('link')).toContain('next')
  expect(await validated.text()).toBe('hello')
  expect(
    new Headers(fetcher.mock.calls[1]![1].headers).get('if-none-match'),
  ).toBe('one')
  const restored = new PublicReadClient({
    fetcher,
    store,
    authenticated: true,
    apiInterval: 0,
    now: () => now,
  })
  expect(await (await restored.fetch()(url)).text()).toBe('hello')
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('force-refresh validates mutable data but reuses immutable content; unavailable storage is harmless', async () => {
  let now = 100
  const store = memory()
  store.get = async () => {
    throw new Error('disabled')
  }
  store.set = async () => {
    throw new Error('full')
  }
  const fetcher = vi.fn(async () => new Response('ok'))
  const client = new PublicReadClient({
    fetcher,
    store,
    authenticated: false,
    apiInterval: 0,
    now: () => now,
  })
  const immutable =
    'https://cdn.jsdelivr.net/gh/a/b@' + 'a'.repeat(40) + '/ahead.yaml'
  await client.fetch()(url)
  await client.fetch()(immutable)
  now++
  await client.fetch({ refresh: true })(url)
  await client.fetch({ refresh: true })(immutable)
  expect(fetcher).toHaveBeenCalledTimes(3)
})
it('classifies quota errors, blocks subsequent network requests and keeps ordinary 403 distinct', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'retry-after': '120' },
      }),
  )
  const client = new PublicReadClient({
    fetcher,
    store: memory(),
    authenticated: false,
    apiInterval: 0,
  })
  await expect(client.fetch()(url)).rejects.toMatchObject({
    limited: true,
    authenticated: false,
    remaining: 0,
  })
  await expect(client.fetch()(url + '/commits/main')).rejects.toThrow(
    'messages.github_access_is_limited_sign_in_for_a_higher_request_limit_2',
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
  const ordinary = new PublicReadClient({
    fetcher: async () => new Response('Access denied', { status: 403 }),
    store: memory(),
    authenticated: true,
    apiInterval: 0,
  })
  await expect(ordinary.fetch()(url)).rejects.toMatchObject({
    limited: false,
    status: 403,
  })
})
it('cancelling one reader preserves another; cancelling a queued sole reader avoids its network call', async () => {
  const gate = deferred<Response>()
  const fetcher = vi.fn().mockReturnValueOnce(gate.promise)
  const client = new PublicReadClient({
    fetcher,
    store: memory(),
    authenticated: true,
    apiInterval: 0,
  })
  const one = new AbortController(),
    queued = new AbortController()
  const first = client.fetch({ signal: one.signal })(url)
  const firstError = expect(first).rejects.toMatchObject({
    name: 'AbortError',
  })
  const second = client.fetch()(url)
  const waiting = client.fetch({ signal: queued.signal })(url + '/tree')
  const waitingError = expect(waiting).rejects.toMatchObject({
    name: 'AbortError',
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  one.abort()
  queued.abort()
  gate.resolve(new Response('shared'))
  await firstError
  await waitingError
  expect(await (await second).text()).toBe('shared')
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('spaces API starts and caps content concurrency', async () => {
  vi.useFakeTimers()
  const starts: number[] = []
  let active = 0,
    max = 0
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('api.github')) starts.push(Date.now())
    else {
      active++
      max = Math.max(active, max)
      await new Promise((resolve) => setTimeout(resolve, 200))
      active--
    }
    return new Response('ok')
  })
  const read = new PublicReadClient({
    fetcher,
    store: memory(),
    authenticated: true,
  }).fetch()
  const results = Promise.all([
    read(url),
    read(url + '/a'),
    read(url + '/b'),
    ...Array.from({ length: 9 }, (_, i) =>
      read('https://cdn.jsdelivr.net/' + i),
    ),
  ])
  await vi.runAllTimersAsync()
  await results
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000)
  expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1000)
  expect(max).toBe(4)
})
