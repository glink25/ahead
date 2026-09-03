import { describe, expect, it } from 'vitest'
import { decryptState, encryptState } from './state.js'

describe('OAuth state', () => {
  it('round-trips redirect_uri and optional pending_token', async () => {
    const secret = 'test-state-secret'
    const encrypted = await encryptState({
      redirect_uri: 'http://localhost:4455/login',
      exp: Date.now() + 60_000,
      pending_token: {
        access_token: 'ghu_pending',
        refresh_token: 'ghr_pending',
        expires_in: 3600,
        scope: 'repo',
      },
    }, secret)

    const state = await decryptState(encrypted, secret)
    expect(state.redirect_uri).toBe('http://localhost:4455/login')
    expect(state.pending_token?.access_token).toBe('ghu_pending')
    expect(state.pending_token?.refresh_token).toBe('ghr_pending')
  })

  it('rejects expired state', async () => {
    const secret = 'test-state-secret'
    const encrypted = await encryptState({
      redirect_uri: 'http://localhost:4455/login',
      exp: Date.now() - 1,
    }, secret)
    await expect(decryptState(encrypted, secret)).rejects.toThrow(/expired/)
  })
})
