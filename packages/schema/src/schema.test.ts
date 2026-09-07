import { describe, expect, it } from 'vitest'
import { createValidator } from './index.js'

describe('OEF schema', () => {
  const validator = createValidator()

  it('accepts a minimal event feed', () => {
    const result = validator.validate('event-feed', {
      oefVersion: '0.1',
      kind: 'event-feed',
      id: 'release-dates',
      name: { en: 'Release dates' },
      events: [{
        id: 'game-release',
        title: { en: 'Game release' },
        schedule: [{
          id: 'announced',
          value: { kind: 'exact', date: '2026-09-10' },
          recordedAt: '2026-09-01T00:00:00Z',
        }],
      }],
    })
    expect(result.ok, JSON.stringify(result.errors)).toBe(true)
  })

  it('rejects invalid protocol data', () => {
    expect(validator.validate('event-feed', {
      oefVersion: '1',
      kind: 'event-feed',
      id: 'Invalid ID',
      name: {},
    }).ok).toBe(false)
  })
})
