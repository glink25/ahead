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
