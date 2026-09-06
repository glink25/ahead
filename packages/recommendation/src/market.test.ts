import { describe, expect, it } from 'vitest'
import type { TemporalValue, UserData } from '@ahead/schema'
import type { ResolvedEvent, ResolvedProfile } from '@ahead/resolver'
import { eventEndedAt, recommendMarket } from './index.js'

const NOW = '2026-09-05T12:00:00.000Z'

function event(id: string, value: TemporalValue, category = 'general', tags: string[] = []): ResolvedEvent {
  const schedule = { id: `schedule:${id}`, value, recordedAt: '2026-01-01T00:00:00.000Z' }
  return {
    id,
    title: { en: id },
    schedule: [schedule],
    currentSchedule: schedule,
    sourceLocators: [category],
    provenance: [],
    tags,
  }
}

function profile(events: ResolvedEvent[], interests: Record<string, number> = {}): ResolvedProfile {
  const user: UserData = {
    oefVersion: '0.1', kind: 'user-data', id: 'profile', displayName: { en: 'Profile' },
  }
  return {
    id: user.id, profile: user, events, locale: 'en', timezone: 'UTC', now: NOW,
    favorites: [], remoteFavorites: {}, hidden: [], pins: [], interests,
    subscriptionPriorities: {},
  }
}

function market(events: ResolvedEvent[], seed = 'seed', interests: Record<string, number> = {}) {
  return recommendMarket({
    events, profile: profile(events, interests), now: NOW, seed,
    categoryFor: (item) => item.sourceLocators[0]!,
  })
}

describe('market recommendations', () => {
  it('drops old events and inserts at most one recent event after nine primary items', () => {
    const future = Array.from({ length: 18 }, (_, index) =>
      event(`future-${index}`, { kind: 'exact', date: '2026-10-01' }, `feed-${index % 3}`),
    )
    const events = [
      ...future,
      event('recent-1', { kind: 'exact', date: '2026-09-03' }, 'past-a'),
      event('recent-2', { kind: 'exact', date: '2026-09-01' }, 'past-b'),
      event('old', { kind: 'exact', date: '2026-08-01' }, 'past-c'),
    ]
    const ids = market(events).map((item) => item.eventId)
    expect(ids).not.toContain('old')
    expect(ids[9]).toMatch(/^recent-/)
    expect(ids[19]).toMatch(/^recent-/)
    expect(ids.filter((id) => id.startsWith('recent-'))).toHaveLength(2)
  })

  it('shows no past event when fewer than nine primary items exist', () => {
    const events = [
      ...Array.from({ length: 8 }, (_, index) => event(`future-${index}`, { kind: 'year', year: 2027 })),
      event('recent', { kind: 'exact', date: '2026-09-03' }, 'past'),
    ]
    expect(market(events).map((item) => item.eventId)).not.toContain('recent')
  })

  it('avoids the last two categories while three are available', () => {
    const events = ['a', 'b', 'c'].flatMap((category) =>
      Array.from({ length: 4 }, (_, index) =>
        event(`${category}-${index}`, { kind: 'year', year: 2027 }, category),
      ),
    )
    const categories = market(events).map((item) => item.event.sourceLocators[0])
    for (let index = 2; index < 9; index += 1) {
      expect(categories[index]).not.toBe(categories[index - 1])
      expect(categories[index]).not.toBe(categories[index - 2])
    }
  })

  it('is stable for one seed and favors interested categories across sessions', () => {
    const events = [
      ...Array.from({ length: 20 }, (_, index) => event(`liked-${index}`, { kind: 'year', year: 2027 }, 'liked', ['space'])),
      ...Array.from({ length: 20 }, (_, index) => event(`other-${index}`, { kind: 'year', year: 2027 }, 'other')),
    ]
    expect(market(events, 'same', { space: 1 })).toEqual(market(events, 'same', { space: 1 }))
    let likedFirst = 0
    for (let index = 0; index < 100; index += 1) {
      if (market(events, `session-${index}`, { space: 1 })[0]?.event.sourceLocators[0] === 'liked') likedFirst += 1
    }
    expect(likedFirst).toBeGreaterThan(65)
  })
})

describe('event lifecycle', () => {
  it('keeps imprecise periods and ranges active until their natural end', () => {
    expect(eventEndedAt(event('month', { kind: 'month', year: 2026, month: 9 }), NOW)).toBeUndefined()
    expect(eventEndedAt(event('quarter', { kind: 'quarter', year: 2026, quarter: 3 }), NOW)).toBeUndefined()
    expect(eventEndedAt(event('year', { kind: 'year', year: 2026 }), NOW)).toBeUndefined()
    expect(eventEndedAt(event('range', {
      kind: 'range',
      start: { kind: 'exact', date: '2026-09-01' },
      end: { kind: 'exact', date: '2026-09-07' },
    }), NOW)).toBeUndefined()
  })

  it('recognizes completed finite recurrence and future recurring occurrences', () => {
    const completed = { ...event('done', { kind: 'exact', date: '2026-08-01' }), recurrence: { freq: 'daily' as const, count: 2 } }
    const recurring = { ...event('annual', { kind: 'exact', date: '2020-10-01' }), recurrence: { freq: 'yearly' as const } }
    expect(eventEndedAt(completed, NOW)?.toISOString()).toBe('2026-08-03T00:00:00.000Z')
    expect(eventEndedAt(recurring, NOW)).toBeUndefined()
  })
})
