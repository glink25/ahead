import { it, expect, vi } from 'vitest'
import { createOctokit } from './octokit'
it('does not retry a missing repository before provisioning it', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
  )
  const client = createOctokit(async () => 'test-token')
  await expect(
    client.request('GET /repos/{owner}/{repo}', {
      owner: 'a',
      repo: 'missing',
      request: { fetch },
    }),
  ).rejects.toMatchObject({ status: 404 })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not add cache directives that GitHub CORS preflight rejects', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":1}', { headers: { 'content-type': 'application/json' } }))
  try {
    await createOctokit(async () => 'test-token').request('GET /user')
    const init = fetch.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(init?.cache).toBeUndefined()
    expect(headers.has('cache-control')).toBe(false)
    expect(headers.has('pragma')).toBe(false)
  } finally { fetch.mockRestore() }
})
