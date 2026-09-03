import type { Duration, Event, TemporalValue } from '@ahead/schema'
import {
  assertDurationFitsRecurrence,
  intervalsIntersect,
  resolveOccurrenceEnd,
} from './duration.js'
import { selectCurrentSchedule } from './schedule.js'
import type { Occurrence } from './types.js'

export interface ExpandRecurrenceOptions {
  from: Date | string
  to: Date | string
  max?: number
}

function temporalStart(value: TemporalValue): Date | undefined {
  switch (value.kind) {
    case 'exact':
      return new Date(`${value.date}T00:00:00.000Z`)
    case 'datetime':
      return new Date(value.dateTime)
    case 'month':
      return new Date(Date.UTC(value.year, value.month - 1, 1))
    case 'quarter':
      return new Date(Date.UTC(value.year, (value.quarter - 1) * 3, 1))
    case 'year':
      return new Date(Date.UTC(value.year, 0, 1))
    case 'range':
      return temporalStart(value.start)
    case 'unknown':
      return undefined
  }
}

function add(date: Date, freq: string, interval: number): Date {
  const next = new Date(date)
  if (freq === 'daily') next.setUTCDate(next.getUTCDate() + interval)
  else if (freq === 'weekly') next.setUTCDate(next.getUTCDate() + interval * 7)
  else if (freq === 'monthly') next.setUTCMonth(next.getUTCMonth() + interval)
  else next.setUTCFullYear(next.getUTCFullYear() + interval)
  return next
}

function matchesFilters(date: Date, byMonth?: number[], byMonthDay?: number[]): boolean {
  return (
    (!byMonth?.length || byMonth.includes(date.getUTCMonth() + 1)) &&
    (!byMonthDay?.length || byMonthDay.includes(date.getUTCDate()))
  )
}

function buildOccurrence(
  event: Event,
  date: Date,
  index: number,
  anchorKind: TemporalValue['kind'],
  duration: Duration | undefined,
): Occurrence {
  const start = date.toISOString()
  const end = resolveOccurrenceEnd(start, duration, anchorKind)
  return {
    id: `${event.id}@${start}`,
    eventId: event.id,
    index,
    start,
    end,
    duration,
    event,
  }
}

export function expandRecurrence(
  event: Event,
  { from, to, max = 100 }: ExpandRecurrenceOptions,
): Occurrence[] {
  const fromDate = new Date(from)
  const toDate = new Date(to)
  if (
    !Number.isFinite(fromDate.getTime()) ||
    !Number.isFinite(toDate.getTime()) ||
    fromDate > toDate
  ) {
    throw new RangeError('expandRecurrence requires a valid, ordered from/to range')
  }

  assertDurationFitsRecurrence(event.duration, event.recurrence)

  const limit = Math.max(0, Math.min(100_000, Math.floor(max)))
  if (limit === 0) return []
  const schedule = selectCurrentSchedule(event.schedule, fromDate)
  const seed = schedule && temporalStart(schedule.value)
  if (!seed || !Number.isFinite(seed.getTime())) return []
  const anchorKind = schedule!.value.kind
  const duration = event.duration

  if (!event.recurrence) {
    const occ = buildOccurrence(event, seed, 0, anchorKind, duration)
    const end = new Date(occ.end ?? occ.start)
    const start = new Date(occ.start)
    return intervalsIntersect(start, end.getTime() === start.getTime() ? new Date(start.getTime() + 1) : end, fromDate, toDate)
      ? [occ]
      : []
  }

  const rule = event.recurrence
  const interval = Math.max(1, Math.floor(rule.interval ?? 1))
  const total = Math.max(0, Math.floor(rule.count ?? Number.MAX_SAFE_INTEGER))
  const until = rule.until ? new Date(rule.until) : undefined
  const endBound = until && Number.isFinite(until.getTime()) && until < toDate ? until : toDate
  const frequency = rule.freq === 'custom' ? 'yearly' : rule.freq
  const result: Occurrence[] = []
  let candidate = seed
  let generated = 0

  for (let scans = 0; candidate <= endBound && generated < total && scans < 1_000_000; scans += 1) {
    if (matchesFilters(candidate, rule.byMonth, rule.byMonthDay)) {
      const occ = buildOccurrence(event, candidate, generated, anchorKind, duration)
      const start = new Date(occ.start)
      const end = new Date(occ.end ?? occ.start)
      const endForIntersect =
        end.getTime() === start.getTime() ? new Date(start.getTime() + 1) : end
      if (intervalsIntersect(start, endForIntersect, fromDate, toDate)) {
        result.push(occ)
      }
      generated += 1
      if (result.length >= limit) break
    }
    const next = add(candidate, frequency, interval)
    if (next <= candidate) break
    candidate = next
  }

  return result
}

export { resolveOccurrenceEnd, assertDurationFitsRecurrence, durationToMs } from './duration.js'
