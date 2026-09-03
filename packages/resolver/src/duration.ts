import type { Duration, TemporalValue } from '@ahead/schema'

export type PreciseAnchorKind = 'exact' | 'datetime'

/** Whether the schedule value is precise enough to compute an Occurrence.end. */
export function isPreciseAnchor(value: TemporalValue): value is Extract<
  TemporalValue,
  { kind: 'exact' } | { kind: 'datetime' }
> {
  return value.kind === 'exact' || value.kind === 'datetime'
}

function calendarDays(amount: number, unit: Duration['unit']): number {
  if (unit === 'days') return amount
  if (unit === 'weeks') return amount * 7
  throw new Error(`calendarDays only supports days|weeks, got ${unit}`)
}

/**
 * Resolve exclusive ISO end for an occurrence start.
 *
 * - date-only + days|weeks: amount N = N inclusive calendar days;
 *   endExclusive = startDate midnight UTC + N days.
 * - minutes|hours, or datetime start: end = start + amount * unit.
 * - Returns undefined when duration missing or anchor not precise.
 */
export function resolveOccurrenceEnd(
  startIso: string,
  duration: Duration | undefined,
  anchorKind: TemporalValue['kind'],
): string | undefined {
  if (!duration) return undefined
  if (anchorKind !== 'exact' && anchorKind !== 'datetime') return undefined

  const start = new Date(startIso)
  if (!Number.isFinite(start.getTime())) return undefined

  const { amount, unit } = duration
  if (!Number.isInteger(amount) || amount < 1) return undefined

  if (anchorKind === 'exact' && (unit === 'days' || unit === 'weeks')) {
    const days = calendarDays(amount, unit)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + days)
    return end.toISOString()
  }

  const end = new Date(start)
  if (unit === 'minutes') end.setUTCMinutes(end.getUTCMinutes() + amount)
  else if (unit === 'hours') end.setUTCHours(end.getUTCHours() + amount)
  else if (unit === 'days') end.setUTCDate(end.getUTCDate() + amount)
  else if (unit === 'weeks') end.setUTCDate(end.getUTCDate() + amount * 7)
  else return undefined

  return end.toISOString()
}

/** Duration length in milliseconds (for overlap checks). Date-only days use calendar N*864e5. */
export function durationToMs(duration: Duration): number {
  const { amount, unit } = duration
  switch (unit) {
    case 'minutes':
      return amount * 60_000
    case 'hours':
      return amount * 3_600_000
    case 'days':
      return amount * 86_400_000
    case 'weeks':
      return amount * 7 * 86_400_000
  }
}

/** Nominal recurrence interval in ms (lower bound for overlap detection). */
export function recurrenceIntervalMs(freq: string, interval = 1): number | undefined {
  const n = Math.max(1, Math.floor(interval))
  switch (freq) {
    case 'daily':
      return n * 86_400_000
    case 'weekly':
      return n * 7 * 86_400_000
    case 'monthly':
      return n * 28 * 86_400_000 // conservative lower bound
    case 'yearly':
    case 'custom':
      return n * 365 * 86_400_000
    default:
      return undefined
  }
}

/**
 * Hard-fail when duration span is >= recurrence interval (occurrences would overlap).
 */
export function assertDurationFitsRecurrence(
  duration: Duration | undefined,
  recurrence: { freq: string; interval?: number } | undefined,
): void {
  if (!duration || !recurrence) return
  const span = durationToMs(duration)
  const gap = recurrenceIntervalMs(recurrence.freq, recurrence.interval ?? 1)
  if (gap !== undefined && span >= gap) {
    throw new RangeError(
      `duration (${duration.amount} ${duration.unit}) is >= recurrence interval (${recurrence.freq}/${recurrence.interval ?? 1}); occurrences would overlap`,
    )
  }
}

export function intervalsIntersect(
  startA: Date,
  endA: Date,
  from: Date,
  to: Date,
): boolean {
  return startA < to && endA > from
}
