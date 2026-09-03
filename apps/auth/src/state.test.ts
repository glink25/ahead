import { describe, expect, it } from 'vitest'
import { decryptState, encryptState } from './state.js'

describe('OAuth state encryption', () => {
  it('round-trips a non-expired redirect', async () => {
    const state = { redirect_uri: 'http://localhost:4455/oauth', exp: 20_000 }
    await expect(decryptState(await encryptState(state, 'test-secret'), 'test-secret', 10_000))
      .resolves.toEqual(state)
  })

  it('rejects expired and tampered state', async () => {
    const encrypted = await encryptState(
      { redirect_uri: 'http://localhost:4455', exp: 10_000 },
      'test-secret',
    )
    await expect(decryptState(encrypted, 'test-secret', 10_000)).rejects.toThrow('expired')
    await expect(decryptState(`${encrypted}x`, 'test-secret', 1)).rejects.toThrow()
  })
})
