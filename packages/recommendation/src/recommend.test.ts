import { describe, expect, it } from 'vitest'
import type { Event, UserData } from '@ahead/schema'
import type { ResolvedEvent, ResolvedProfile } from '@ahead/resolver'
import golden from './recommend.golden.json'
import { assignBucket, DEFAULT_RECOMMENDATION_CONFIG, recommend } from './index.js'

function resolvedEvent(input: (typeof golden.input.events)[number]): ResolvedEvent {
  const value = input.date
    ? ({ kind: 'exact', date: input.date } as const)
    : ({ kind: 'unknown' } as const)
  const base: Event = {
    id: input.id,
    title: { en: input.id },
    tags: input.tags,
    schedule: [
      {
        id: `schedule:${input.id}`,
        value,
        recordedAt: '2026-01-01T00:00:00.000Z',
        confidence: 'confirmed',
      },
    ],
  }
  return {
    ...base,
    currentSchedule: base.schedule[0],
    sourceLocators: ['feed'],
    provenance: [],
  }
}

function profile(): ResolvedProfile {
  const user: UserData = {
    oefVersion: '0.1',
    kind: 'user-data',
    id: 'profile',
    displayName: { en: 'Profile' },
  }
  return {
    id: user.id,
    profile: user,
    events: [],
    locale: 'en',
    timezone: 'UTC',
    now: golden.input.now,
    favorites: golden.input.favorites,
    remoteFavorites: {},
    hidden: [],
    pins: [],
    interests: golden.input.interests,
    subscriptionPriorities: {},
  }
}

describe('recommendation golden', () => {
  it('uses stable bucket boundaries', () => {
    expect([0, 6.999, 7, 30, 90, 365, null].map((days) => assignBucket(days))).toEqual([
      '0-7d',
      '0-7d',
      '7-30d',
      '1-3m',
      '3-12m',
      '1y+',
      'unknown',
    ])
  })

  it('matches the fixed interleaved output', () => {
    const result = recommend({
      events: golden.input.events.map(resolvedEvent),
      profile: profile(),
      now: golden.input.now,
    }).map(({ eventId, score, bucket, rank }) => ({ eventId, score, bucket, rank }))
    expect(result).toEqual(golden.output)
  })

  it('uses event id to break equal scores deterministically', () => {
    const events = ['b', 'a'].map((id) =>
      resolvedEvent({ id, date: '2026-09-04', tags: [] }),
    )
    const options = { events, profile: profile(), now: golden.input.now }
    expect(recommend(options).map(({ eventId }) => eventId)).toEqual(['a', 'b'])
    expect(recommend(options)).toEqual(recommend(options))
  })

  it('puts ongoing duration events in 0-7d with ongoingBoost', () => {
    const base = resolvedEvent({ id: 'holiday', date: '2026-09-01', tags: [] })
    const event: ResolvedEvent = {
      ...base,
      duration: { amount: 7, unit: 'days' },
    }
    const [item] = recommend({
      events: [event],
      profile: profile(),
      now: '2026-09-03T00:00:00.000Z',
    })
    expect(item?.bucket).toBe('0-7d')
    expect(item?.daysUntil).toBe(0)
    expect(item?.score).toBe(DEFAULT_RECOMMENDATION_CONFIG.ongoingBoost)
  })
})
