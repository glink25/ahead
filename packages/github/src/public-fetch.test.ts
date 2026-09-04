import { it, expect, vi } from 'vitest'
import { createPublicFetch } from './public-fetch'
it('uses the signed-in quota for API metadata without sending credentials to content hosts', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
  const credential = vi.fn(async () => 'test-token')
  try {
    const read = createPublicFetch(credential)
    for (const url of ['https://api.github.com/repos/a/b', 'https://cdn.jsdelivr.net/gh/a/b@sha/ahead.yaml', 'https://raw.githubusercontent.com/a/b/sha/ahead.yaml', 'https://api.github.com.evil.example/a']) await read(url)
    expect(credential).toHaveBeenCalledTimes(1)
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer test-token')
    for (const call of fetch.mock.calls.slice(1)) expect(new Headers(call[1]?.headers).has('Authorization')).toBe(false)
  } finally { fetch.mockRestore() }
})
