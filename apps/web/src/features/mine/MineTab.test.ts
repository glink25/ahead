import { expect, it } from 'vitest'
import { resolvedEvent } from '../../lib/test-fixtures'
import { partitionTimelineEvents } from './timeline'

it('hides only events that have fully ended from the current timeline', () => {
  const ended = resolvedEvent('ended', { kind: 'exact', date: '2026-09-01' })
  const today = resolvedEvent('today', { kind: 'exact', date: '2026-09-05' })
  const ongoing = resolvedEvent('ongoing', { kind: 'exact', date: '2026-09-04' })
  ongoing.duration = { amount: 2, unit: 'days' }
  const future = resolvedEvent('future', { kind: 'exact', date: '2026-10-01' })
  const unknown = resolvedEvent('unknown', { kind: 'unknown' })
  const recurring = resolvedEvent('recurring', {
    kind: 'exact',
    date: '2026-09-01',
  })
  recurring.recurrence = { freq: 'daily', count: 2 }

  const result = partitionTimelineEvents(
    [ended, today, ongoing, future, unknown, recurring],
    '2026-09-05T12:00:00Z',
  )

  expect(result.history.map((event) => event.id)).toEqual([
    'ended',
    'recurring',
  ])
  expect(result.current.map((event) => event.id)).toEqual([
    'today',
    'ongoing',
    'future',
    'unknown',
  ])
})
