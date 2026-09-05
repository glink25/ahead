import type { TemporalValue } from '@ahead/schema'
import {
  expandRecurrence,
  resolveOccurrenceEnd,
  selectCurrentSchedule,
  type ResolvedEvent,
  type ResolvedProfile,
} from '@ahead/resolver'
import {
  DEFAULT_RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from './config.js'

export interface ScoreContext {
  profile: ResolvedProfile
  now: Date | string
  config?: RecommendationConfig
}

function temporalDate(value: TemporalValue): Date | undefined {
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
      return temporalDate(value.start)
    case 'unknown':
      return undefined
  }
}

function defaultEnd(start: Date, value: TemporalValue): Date | undefined {
  const end = new Date(start)
  switch (value.kind) {
    case 'exact':
      end.setUTCDate(end.getUTCDate() + 1)
      return end
    case 'datetime':
      return end
    case 'month':
      end.setUTCMonth(end.getUTCMonth() + 1)
      return end
    case 'quarter':
      end.setUTCMonth(end.getUTCMonth() + 3)
      return end
    case 'year':
      end.setUTCFullYear(end.getUTCFullYear() + 1)
      return end
    case 'range': {
      const rangeEnd = temporalDate(value.end)
      return rangeEnd ? defaultEnd(rangeEnd, value.end) : undefined
    }
    case 'unknown':
      return undefined
  }
}

/** Exclusive end of an event, or undefined while it is ongoing/future/unknown. */
export function eventEndedAt(event: ResolvedEvent, now: Date | string): Date | undefined {
  const clock = new Date(now)
  if (!Number.isFinite(clock.getTime())) return undefined
  const schedule = event.currentSchedule ?? selectCurrentSchedule(event.schedule, clock)
  if (!schedule) return undefined
  const seed = temporalDate(schedule.value)
  if (!seed || !Number.isFinite(seed.getTime())) return undefined

  if (event.recurrence) {
    const horizon = new Date(clock)
    horizon.setUTCFullYear(horizon.getUTCFullYear() + 100)
    const occurrences = expandRecurrence(event, {
      from: seed,
      to: horizon,
      max: event.recurrence.count ?? 100_000,
    })
    let latestEnd: Date | undefined
    for (const occurrence of occurrences) {
      const start = new Date(occurrence.start)
      const end = occurrence.end
        ? new Date(occurrence.end)
        : defaultEnd(start, schedule.value)
      if (!end) return undefined
      if (end > clock) return undefined
      latestEnd = end
    }
    return latestEnd
  }

  const durationEnd = resolveOccurrenceEnd(
    seed.toISOString(),
    event.duration,
    schedule.value.kind,
  )
  const end = durationEnd ? new Date(durationEnd) : defaultEnd(seed, schedule.value)
  return end && end <= clock ? end : undefined
}

export function eventInterval(
  event: ResolvedEvent,
  now: Date | string,
): { start: Date; end?: Date } | undefined {
  const clock = new Date(now)
  const schedule = event.currentSchedule ?? selectCurrentSchedule(event.schedule, clock)
  if (!schedule) return undefined
  const start = temporalDate(schedule.value)
  if (!start || !Number.isFinite(start.getTime())) return undefined
  if (event.recurrence) {
    const horizon = new Date(clock)
    horizon.setUTCFullYear(horizon.getUTCFullYear() + 100)
    const next = expandRecurrence(event, { from: clock, to: horizon, max: 1 })[0]
    if (next) return { start: new Date(next.start), end: next.end ? new Date(next.end) : undefined }
  }
  const endIso = resolveOccurrenceEnd(start.toISOString(), event.duration, schedule.value.kind)
  return { start, end: endIso ? new Date(endIso) : undefined }
}

/** True when now is in [start, end). */
export function isEventOngoing(event: ResolvedEvent, now: Date | string): boolean {
  const interval = eventInterval(event, now)
  if (!interval?.end) return false
  const clock = new Date(now)
  return clock >= interval.start && clock < interval.end
}

export function daysUntilEvent(event: ResolvedEvent, now: Date | string): number | null {
  const clock = new Date(now)
  if (isEventOngoing(event, clock)) return 0

  const interval = eventInterval(event, clock)
  if (!interval || !Number.isFinite(clock.getTime())) return null
  return (interval.start.getTime() - clock.getTime()) / 86_400_000
}

export function scoreEvent(event: ResolvedEvent, ctx: ScoreContext): number {
  const config = ctx.config ?? DEFAULT_RECOMMENDATION_CONFIG
  let score = 0

  if (ctx.profile.favorites.includes(event.id)) score += config.favoriteBoost
  score += Math.min(
    (ctx.profile.remoteFavorites[event.id] ?? 0) * config.remoteFavoriteWeight,
    config.remoteFavoriteCap,
  )

  const interest = (event.tags ?? []).reduce(
    (sum, tag) => sum + (ctx.profile.interests[tag] ?? 0),
    0,
  )
  score += interest * config.interestWeight

  const priorities = event.sourceLocators
    .map((locator) => ctx.profile.subscriptionPriorities[locator])
    .filter((value): value is number => value !== undefined)
  const priority = priorities.length > 0 ? Math.max(...priorities) : 0
  score += priority * config.priorityWeight

  const schedule = event.currentSchedule ?? selectCurrentSchedule(event.schedule, ctx.now)
  if (schedule && config.noveltyDays > 0) {
    const age = (new Date(ctx.now).getTime() - Date.parse(schedule.recordedAt)) / 86_400_000
    if (Number.isFinite(age) && age >= 0 && age < config.noveltyDays) {
      score += (1 - age / config.noveltyDays) * config.noveltyWeight
    }
  }

  if (isEventOngoing(event, ctx.now)) score += config.ongoingBoost

  return score
}
