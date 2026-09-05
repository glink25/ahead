import { it, expect } from 'vitest'
import {
  firstDayOfWeek,
  monthOccurrences,
  resolveFirstDayOfWeek,
} from './MonthView'
import { resolvedEvent } from '../../lib/test-fixtures'
it('expands yearly recurrence and multi-day duration with exclusive end', () => {
  const event = resolvedEvent('holiday', { kind: 'exact', date: '2020-10-01' })
  event.currentSchedule = event.schedule[0]
  event.recurrence = { freq: 'yearly' }
  event.duration = { amount: 7, unit: 'days' }
  const days = monthOccurrences([event], 2027, 9)
  expect(days.size).toBe(7)
  expect(days.has('2027-10-07')).toBe(true)
  expect(days.has('2027-10-08')).toBe(false)
})
it('uses display timezone for datetime and does not fake fuzzy dates', () => {
  const exact = resolvedEvent('late', { kind: 'datetime', dateTime: '2027-01-01T16:00:00Z' })
  exact.currentSchedule = exact.schedule[0]
  const fuzzy = resolvedEvent('quarter', { kind: 'quarter', year: 2027, quarter: 1 })
  fuzzy.currentSchedule = fuzzy.schedule[0]
  const days = monthOccurrences([exact, fuzzy], 2027, 0)
  expect([...days.keys()]).toEqual(['2027-01-02'])
})

it('fills every day in an exact range without duplicating an event', () => {
  const event = resolvedEvent('trip', {
    kind: 'range',
    start: { kind: 'exact', date: '2027-01-30' },
    end: { kind: 'exact', date: '2027-02-02' },
  })
  event.currentSchedule = event.schedule[0]
  expect([...monthOccurrences([event], 2027, 1).keys()]).toEqual([
    '2027-02-01',
    '2027-02-02',
  ])
})

it('uses locale week conventions with a stable fallback', () => {
  expect(firstDayOfWeek('zh-CN')).toBe(1)
  expect(firstDayOfWeek('en-US')).toBe(0)
  expect(resolveFirstDayOfWeek('zh-CN', 'sunday')).toBe(0)
  expect(resolveFirstDayOfWeek('en-US', 'monday')).toBe(1)
  expect(resolveFirstDayOfWeek('zh-CN')).toBe(1)
})
