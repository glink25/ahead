import { describe, expect, it } from 'vitest'
import { sourceKey } from '@ahead/protocol'
import type { Event, EventFeed, Patch, UserData } from '@ahead/schema'
import {
  ResourceGraph,
  applyPatches,
  expandRecurrence,
  mergeEvents,
  resolve,
  resolveOccurrenceEnd,
  selectCurrentSchedule,
} from './index.js'

const event = (id = 'event:one'): Event => ({
  id,
  title: { en: 'One' },
  schedule: [
    {
      id: 'schedule:one',
      value: { kind: 'exact', date: '2026-09-10' },
      recordedAt: '2026-09-01T00:00:00Z',
      confidence: 'confirmed',
    },
  ],
})

describe('resolver', () => {
  it('selects by confidence, precision, recency and stable id', () => {
    const selected = selectCurrentSchedule([
      {
        id: 'z',
        value: { kind: 'exact', date: '2027-01-01' },
        recordedAt: '2026-01-01T00:00:00Z',
        confidence: 'likely',
      },
      {
        id: 'b',
        value: { kind: 'month', year: 2027, month: 1 },
        recordedAt: '2026-09-01T00:00:00Z',
        confidence: 'confirmed',
      },
      {
        id: 'a',
        value: { kind: 'exact', date: '2027-01-01' },
        recordedAt: '2026-02-01T00:00:00Z',
        confidence: 'confirmed',
      },
    ])
    expect(selected?.id).toBe('a')
  })

  it('detects cycles and rejects feed outgoing edges', () => {
    const graph = new ResourceGraph()
      .addResource('a', 'user')
      .addResource('b', 'user')
      .addEdge('a', 'b', 'user-data')
      .addEdge('b', 'a', 'user-data')
    expect(graph.detectCycles()).toEqual([['a', 'b', 'a']])

    const invalid = new ResourceGraph().addResource('feed', 'feed').addEdge('feed', 'x', 'x')
    expect(() => invalid.assertNoFeedEdges()).toThrow(/Feed resources/)
  })

  it('bounds recurrence expansion', () => {
    const recurring = { ...event(), recurrence: { freq: 'daily' as const } }
    const occurrences = expandRecurrence(recurring, {
      from: '2026-09-01',
      to: '2030-09-01',
      max: 3,
    })
    expect(occurrences).toHaveLength(3)
    expect(occurrences.map(({ index }) => index)).toEqual([0, 1, 2])
  })

  it('resolves calendar-day duration end exclusively and intersects query windows', () => {
    const holiday: Event = {
      ...event('national-day'),
      schedule: [
        {
          id: 's1',
          value: { kind: 'exact', date: '2026-10-01' },
          recordedAt: '2025-01-01T00:00:00Z',
          confidence: 'confirmed',
        },
      ],
      duration: { amount: 7, unit: 'days' },
    }
    const [occ] = expandRecurrence(holiday, {
      from: '2026-10-05T00:00:00Z',
      to: '2026-10-06T00:00:00Z',
    })
    expect(occ?.start).toBe('2026-10-01T00:00:00.000Z')
    expect(occ?.end).toBe('2026-10-08T00:00:00.000Z')
    expect(resolveOccurrenceEnd(occ!.start, holiday.duration, 'exact')).toBe(occ?.end)
  })

  it('resolves datetime duration in hours', () => {
    const talk: Event = {
      ...event('keynote'),
      schedule: [
        {
          id: 's1',
          value: { kind: 'datetime', dateTime: '2026-09-09T06:00:00.000Z' },
          recordedAt: '2026-01-01T00:00:00Z',
        },
      ],
      duration: { amount: 2, unit: 'hours' },
    }
    const [occ] = expandRecurrence(talk, {
      from: '2026-09-09T00:00:00Z',
      to: '2026-09-10T00:00:00Z',
    })
    expect(occ?.end).toBe('2026-09-09T08:00:00.000Z')
  })

  it('rejects duration that overlaps recurrence interval', () => {
    const bad: Event = {
      ...event(),
      duration: { amount: 36, unit: 'hours' },
      recurrence: { freq: 'daily' },
    }
    expect(() =>
      expandRecurrence(bad, { from: '2026-09-01', to: '2026-09-10' }),
    ).toThrow(/overlap/)
  })

  it('does not invent end for fuzzy schedule anchors', () => {
    expect(
      resolveOccurrenceEnd('2026-01-01T00:00:00.000Z', { amount: 3, unit: 'days' }, 'month'),
    ).toBeUndefined()
  })

  it('applies set, merge and unset patches without mutation', () => {
    const original = event()
    const patches: Patch[] = [
      {
        eventId: original.id,
        ops: [
          { op: 'set', path: '/summary', value: { en: 'Summary' } },
          { op: 'merge', path: 'extensions', value: { source: 'test' } },
          { op: 'unset', path: '/title/en' },
        ],
      },
    ]
    const patched = applyPatches(original, patches)
    expect(patched).toMatchObject({ summary: { en: 'Summary' }, extensions: { source: 'test' } })
    expect(patched.title).toEqual({})
    expect(original.title).toEqual({ en: 'One' })
  })

  it('deduplicates by id and records field provenance', () => {
    const merged = mergeEvents([
      { event: event(), sourceLocator: 'github:a/feed' },
      {
        event: { ...event(), summary: { en: 'Summary' } },
        sourceLocator: 'github:b/feed',
      },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.summary).toEqual({ en: 'Summary' })
    expect(merged[0]?.provenance).toContainEqual({
      field: 'summary',
      sourceLocator: 'github:b/feed',
      reason: 'filled',
    })
  })

  it('is deterministic for identical inputs', () => {
    const feed: EventFeed = {
      oefVersion: '0.1',
      kind: 'event-feed',
      id: 'feed',
      name: { en: 'Feed' },
      events: [event()],
    }
    const profile: UserData = {
      oefVersion: '0.1',
      kind: 'user-data',
      id: 'user',
      displayName: { en: 'User' },
    }
    const input = {
      feeds: [feed],
      users: [profile],
      activeProfile: 'user',
      now: '2026-09-03T00:00:00Z',
    }
    expect(resolve(input)).toEqual(resolve(input))
  })
})

it('counts only explicitly followed sources, including profiles with the same document id, and honors frequency', () => {
  const source = { locator: 'github:friend/profile', kind: 'user-data' as const }
  const active: UserData = { oefVersion: '0.1', kind: 'user-data', id: 'shared-id', displayName: { en: 'Me' }, subscriptions: [source] }
  const friend: UserData = { ...active, displayName: { en: 'Friend' }, subscriptions: [], favorites: ['event:one', 'event:one'] }
  const remote = { user: friend, sourceLocator: 'github:friend/profile#ahead.yaml' }
  // Use protocol normalization; the repository path is the source identity.
  const key = sourceKey(source)
  remote.sourceLocator = key
  const options = { feeds: [], users: [active, remote, remote, { user: { ...friend, id: 'stranger' }, sourceLocator: 'stranger' }], activeProfile: active }
  expect(resolve(options).remoteFavorites).toEqual({ 'event:one': 1 })
  active.subscriptions![0]!.priority = -3
  expect(resolve(options).remoteFavorites['event:one']).toBe(0.5)
  active.subscriptions![0]!.priority = 3
  expect(resolve(options).remoteFavorites['event:one']).toBe(2)
  active.subscriptions = []
  expect(resolve(options).remoteFavorites).toEqual({})
  expect(resolve(options).favorites).toEqual([])
})
