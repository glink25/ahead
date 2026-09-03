import { describe, expect, it } from 'vitest'
import { deriveCapabilitiesFromScopes } from './capabilities.js'

describe('deriveCapabilitiesFromScopes', () => {
  it('grants full repository capabilities for repo and read:user', () => {
    const report = deriveCapabilitiesFromScopes(['repo', 'read:user'])

    expect(report).toMatchObject({
      canReadPublic: true,
      canReadPrivate: true,
      canCreateRepository: true,
      canWriteContents: true,
      canReadMarketIssues: true,
      missingScopes: [],
    })
  })

  it('keeps anonymous reads while explaining missing write scopes', () => {
    const report = deriveCapabilitiesFromScopes([])

    expect(report.canReadPublic).toBe(true)
    expect(report.canReadPrivate).toBe(false)
    expect(report.canWriteContents).toBe(false)
    expect(report.missingScopes).toEqual(['repo', 'public_repo', 'read:user'])
    expect(report.diagnostics.every((message) => /[\u4e00-\u9fff]/u.test(message))).toBe(true)
  })

  it('uses public_repo for public repository writes only', () => {
    const report = deriveCapabilitiesFromScopes([' PUBLIC_REPO ', 'read:user'])

    expect(report.canWriteContents).toBe(true)
    expect(report.canReadPrivate).toBe(false)
  })
})
