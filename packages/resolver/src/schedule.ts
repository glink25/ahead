import type { ScheduleTimeline, ScheduleTimelineEntry, TemporalValue } from '@ahead/schema'

const CONFIDENCE_ORDER = {
  confirmed: 0,
  likely: 1,
  rumored: 2,
  cancelled: 3,
} as const

const PRECISION_ORDER: Record<TemporalValue['kind'], number> = {
  exact: 0,
  datetime: 0,
  month: 1,
  quarter: 2,
  year: 3,
  range: 4,
  unknown: 5,
}

function compareEntries(a: ScheduleTimelineEntry, b: ScheduleTimelineEntry): number {
  const confidence =
    CONFIDENCE_ORDER[a.confidence ?? 'confirmed'] -
    CONFIDENCE_ORDER[b.confidence ?? 'confirmed']
  if (confidence !== 0) return confidence

  const precision = PRECISION_ORDER[a.value.kind] - PRECISION_ORDER[b.value.kind]
  if (precision !== 0) return precision

  const recorded = Date.parse(b.recordedAt) - Date.parse(a.recordedAt)
  if (Number.isFinite(recorded) && recorded !== 0) return recorded
  return a.id.localeCompare(b.id)
}

/**
 * Select the authoritative schedule entry. `now` is accepted to keep the
 * resolver API clock-explicit; timeline authority itself is independent of it.
 */
export function selectCurrentSchedule(
  timeline: ScheduleTimeline,
  _now: Date | string = new Date(),
): ScheduleTimelineEntry | undefined {
  return [...timeline].sort(compareEntries)[0]
}
