import { it, expect, vi, afterEach } from 'vitest'
import { main, parseSubmission, registryBody } from './market-triage'
import { parseMarketIssueBody, serializeManifestBlock, serializeSourceBlock } from '../packages/market/src/format'
it('uses edited form fields instead of stale bot metadata', () => {
  const previous = { schema: 1 as const, locator: 'github:a/b', manifestPath: 'old.yaml', resourceType: 'event-feed' as const }
  const body = '### Locator\n\ngithub:a/c\n\n### Manifest path\n\nfeeds/new.yaml\n\n' + serializeSourceBlock(previous) + '\n' + serializeManifestBlock('events: [old]')
  const source = parseSubmission(body)
  expect(source.manifestPath).toBe('feeds/new.yaml')
  expect(source.locator).toBe('github:a/c')
  const updated = registryBody(body, source)
  expect(updated).not.toContain('events: [old]')
  expect(parseMarketIssueBody(updated)).toEqual({ source })
})
it('rejects paths escaping the repository', () => {
  expect(() => parseSubmission('### Locator\n\ngithub:a/b\n\n### Manifest path\n\n../private')).toThrow()
})

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
it.each([true, false])('reconciles approval labels and only writes metadata (valid=%s)', async (valid) => {
  vi.stubEnv('GITHUB_TOKEN', 'test-only-token')
  vi.stubEnv('GITHUB_REPOSITORY', 'test/market')
  vi.stubEnv('ISSUE_NUMBER', '1')
  vi.stubEnv('DRY_RUN', '')
  vi.stubEnv('GITHUB_OUTPUT', '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const issue = { body: '### Locator\n\ngithub:a/b\n\n### Manifest path\n\nfeeds/a.yaml\n', labels: [{ name: 'approved' }, { name: 'needs-changes' }, { name: 'trust:community' }] }
  const document = valid ? { oefVersion: '0.1', kind: 'event-feed', id: 'sample', name: { en: 'Sample' }, events: [] } : {}
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method) return new Response('{}')
    if (url.includes('/issues/')) return new Response(JSON.stringify(issue))
    if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'a'.repeat(40) }))
    if (url.includes('/contents/')) return new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify(document)).toString('base64') }))
    return new Response(JSON.stringify({ private: false, default_branch: 'main' }))
  })
  vi.stubGlobal('fetch', fetcher)
  if (valid) await main()
  else await expect(main()).rejects.toThrow()
  const update = fetcher.mock.calls.find((call) => call[1]?.method === 'PATCH')
  const payload = JSON.parse(String(update?.[1]?.body))
  expect(payload.labels).toContain('trust:community')
  expect(payload.labels).toContain(valid ? 'approved' : 'needs-changes')
  expect(payload.labels).not.toContain(valid ? 'needs-changes' : 'approved')
  if (valid) {
    expect(parseMarketIssueBody(payload.body)?.manifest).toBeUndefined()
    expect(parseMarketIssueBody(payload.body)?.source.validatedSha).toBe('a'.repeat(40))
  } else expect(fetcher.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true)
})
