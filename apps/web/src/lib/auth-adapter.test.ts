import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ getCredential: vi.fn() }))
vi.mock('@ahead/github', () => ({
  PersonalAccessTokenProvider: class { getCredential = state.getCredential },
  GitHubOAuthProvider: class { id = 'oauth'; getCredential = state.getCredential },
  OctokitAdapter: class { constructor(public credential: () => Promise<string>) {} },
  createPublicFetch: vi.fn(),
}))
vi.mock('../token-store', () => ({ indexedDbOAuthCredentialStore: {}, indexedDbTokenStore: {} }))
vi.mock('../stores', () => ({ useAuthSession: { getState: () => ({ session: null }) } }))
it('rejects credentials acquired while an account switch invalidates the request', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost' })
  try {
    const { authenticatedAdapter } = await import('./auth')
    let current = true
    state.getCredential.mockImplementation(async () => { current = false; return { accessToken: 'other-account' } })
    const adapter = authenticatedAdapter(null, () => { if (!current) throw new Error('session changed') }) as unknown as { credential(): Promise<string> }
    await expect(adapter.credential()).rejects.toThrow('session changed')
    state.getCredential.mockClear()
    await expect(adapter.credential()).rejects.toThrow('session changed')
    expect(state.getCredential).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
