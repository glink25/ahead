import type { RepositoryAdapter } from '@ahead/core'
import type { GitHubSearchAdapter } from '@ahead/github'
import { expect, it, vi } from 'vitest'
import { feed } from '../lib/test-fixtures'
import { memory } from './test-helpers'
import {
  buildCodeQuery,
  SearchFeedApi,
  type SearchFeedEvent,
  type SearchFeedStatus,
} from './search-feed-api'

const sha = 'a'.repeat(40)
const hit = (path: string) => ({
  path,
  repository: { name: 'calendar', owner: { login: 'alice' } },
})

function harness(options: {
  files: Record<string, unknown>
  search: GitHubSearchAdapter['searchCode']
  private?: boolean
  cache?: ReturnType<typeof memory>
}) {
  const readFile = vi.fn(async (_locator, path: string) => {
    if (!(path in options.files)) throw new Error('missing ' + path)
    return { path, content: JSON.stringify(options.files[path]), sha, encoding: 'utf-8' }
  })
  const readTree = vi.fn(async () => { throw new Error('search must not scan repository trees') })
  const adapter: RepositoryAdapter & GitHubSearchAdapter = {
    inspect: async (locator) => ({
      locator,
      defaultBranch: 'main',
      headSha: sha,
      private: options.private ?? false,
    }),
    readFile,
    readTree,
    searchCode: vi.fn(options.search),
    commitFiles: async () => { throw new Error('read only') },
    createRepository: async () => { throw new Error('read only') },
  }
  return {
    api: new SearchFeedApi({ adapter, cache: options.cache ?? memory() }),
    adapter,
    readFile,
    readTree,
  }
}

async function run(api: SearchFeedApi, request: { query: string } | { tag: string }) {
  const events: SearchFeedEvent[] = []
  const statuses: SearchFeedStatus[] = []
  const session = api.openSession({
    request,
    receive: (event) => events.push(event),
    status: (status) => statuses.push(status),
  })
  session.setActive(true)
  await vi.waitFor(() => expect(statuses.at(-1)).toMatch(/paused|complete|failed/u))
  return { events, statuses, session }
}

it('builds a GitHub-filtered query with keywords, structure and the root marker', () => {
  const query = buildCodeQuery({ query: 'game release' })
  expect(query).toContain('"game" "release"')
  expect(query).toContain('"schedule"')
  expect(query).toContain('"oefSearch" "oef-search-v1"')
  expect(query).toMatch(/ in:file$/u)
  expect(buildCodeQuery({ tag: 'games' })).toContain('"games" "tags"')
})

it('streams only matching inline events and rejects a nested marker', async () => {
  const marked = {
    ...feed([
      { ...feed().events![0]!, id: 'match', title: { en: 'Game release' } },
      { ...feed().events![0]!, id: 'other', title: { en: 'Concert' } },
    ]),
    oefSearch: 'oef-search-v1' as const,
  }
  const nested = { ...feed(), extensions: { oefSearch: 'oef-search-v1' } }
  const { api } = harness({
    files: { 'marked.json': marked, 'nested.json': nested },
    search: async () => ({
      total_count: 2,
      incomplete_results: false,
      items: [hit('marked.json'), hit('nested.json')],
    }),
  })
  const { events } = await run(api, { query: 'game' })
  expect(events.filter((event) => event.type === 'feed')).toHaveLength(1)
  expect(events.find((event) => event.type === 'feed')).toMatchObject({
    feed: { feed: { events: [{ id: 'match' }] } },
  })
})

it('maps standalone events to a manifest without reading the repository tree', async () => {
  const standalone = {
    ...feed().events![0]!,
    id: 'game',
    title: { en: 'Game launch' },
    oefSearch: 'oef-search-v1' as const,
  }
  const manifest = { ...feed([]), eventsGlob: 'events/*.json' }
  const { api, readTree, adapter } = harness({
    files: { 'events/game.json': standalone, 'feeds/ahead.json': manifest },
    search: async (query) => ({
      total_count: 1,
      incomplete_results: false,
      items: query.includes('repo:alice/calendar')
        ? [hit('feeds/ahead.json')]
        : [hit('events/game.json')],
    }),
  })
  const { events } = await run(api, { query: 'game' })
  expect(events.find((event) => event.type === 'feed')).toMatchObject({
    feed: {
      manifestPath: 'feeds/ahead.json',
      feed: { events: [{ id: 'game' }] },
    },
  })
  expect(readTree).not.toHaveBeenCalled()
  expect(adapter.searchCode).toHaveBeenCalledTimes(2)
})

it('persists immutable public files but never private files', async () => {
  const document = {
    ...feed([{ ...feed().events![0]!, title: { en: 'Game' } }]),
    oefSearch: 'oef-search-v1' as const,
  }
  const search = async () => ({
    total_count: 1,
    incomplete_results: false,
    items: [hit('ahead.json')],
  })
  const publicHarness = harness({ files: { 'ahead.json': document }, search })
  await run(publicHarness.api, { query: 'game' })
  await run(publicHarness.api, { query: 'game' })
  expect(publicHarness.readFile).toHaveBeenCalledTimes(1)

  const privateCache = memory()
  const privateSet = vi.spyOn(privateCache, 'set')
  const privateHarness = harness({
    files: { 'ahead.json': document },
    search,
    private: true,
    cache: privateCache,
  })
  await run(privateHarness.api, { query: 'game' })
  await run(privateHarness.api, { query: 'game' })
  expect(privateHarness.readFile).toHaveBeenCalledTimes(2)
  expect(privateSet).not.toHaveBeenCalled()
})

it('pauses after a result page and loads the next page near the end', async () => {
  const marked = (id: string) => ({
    ...feed([{ ...feed().events![0]!, id, title: { en: 'Game ' + id } }]),
    oefSearch: 'oef-search-v1' as const,
  })
  const { api, adapter } = harness({
    files: { 'one.json': marked('one'), 'two.json': marked('two') },
    search: async (_query, page) => ({
      total_count: 101,
      incomplete_results: false,
      items: [hit(page === 1 ? 'one.json' : 'two.json')],
    }),
  })
  const result = await run(api, { query: 'game' })
  expect(result.statuses.at(-1)).toBe('paused')
  result.session.reportVisible(0, 1)
  await vi.waitFor(() => expect(result.statuses.at(-1)).toBe('complete'))
  expect(adapter.searchCode).toHaveBeenCalledTimes(2)
  expect(result.events.filter((event) => event.type === 'feed')).toHaveLength(2)
})

it('skips an empty invalid page and preserves GitHub incomplete warnings', async () => {
  const document = {
    ...feed([{ ...feed().events![0]!, title: { en: 'Game' } }]),
    oefSearch: 'oef-search-v1' as const,
  }
  const { api, adapter } = harness({
    files: { 'invalid.json': { nope: true }, 'valid.json': document },
    search: async (_query, page) => ({
      total_count: 101,
      incomplete_results: page === 2,
      items: [hit(page === 1 ? 'invalid.json' : 'valid.json')],
    }),
  })
  const result = await run(api, { query: 'game' })
  expect(adapter.searchCode).toHaveBeenCalledTimes(2)
  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'error', reason: 'incomplete-results' }),
    expect.objectContaining({ type: 'feed' }),
    expect.objectContaining({ type: 'progress', complete: true }),
  ]))
})

it('maps GitHub authentication and rate-limit failures to stable reasons', async () => {
  for (const [error, reason] of [
    [Object.assign(new Error('Bad credentials'), { status: 401 }), 'authentication-expired'],
    [Object.assign(new Error('API rate limit exceeded'), { status: 403 }), 'rate-limited'],
  ] as const) {
    const { api } = harness({
      files: {},
      search: async () => { throw error },
    })
    const result = await run(api, { query: 'game' })
    expect(result.statuses.at(-1)).toBe('failed')
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'error', reason }))
  }
})
