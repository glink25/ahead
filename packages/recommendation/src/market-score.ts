import type { ResolvedEvent, ResolvedProfile } from '@ahead/resolver'
import { DEFAULT_MARKET_RECOMMENDATION_CONFIG } from './market-config.js'
import type {
  EventLifecycle,
  ExposureSignal,
  RecommendationConfigV2,
} from './market-types.js'

const DAY = 86_400_000
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export function scoreTemporalUrgency(
  daysUntil: number | null,
  lifecycle: EventLifecycle,
  config: RecommendationConfigV2 = DEFAULT_MARKET_RECOMMENDATION_CONFIG,
): number {
  if (
    daysUntil === null ||
    lifecycle === 'unknown' ||
    lifecycle === 'recent-past' ||
    lifecycle === 'expired'
  )
    return 0
  const urgency = 2 ** (-Math.max(0, daysUntil) / config.urgencyHalfLifeDays)
  return (
    urgency * config.temporalWeight +
    (lifecycle === 'current' || daysUntil < 1 ? config.currentBoost : 0)
  )
}

export function scoreAffinity(
  event: ResolvedEvent,
  profile: ResolvedProfile,
): number {
  const interests = event.tags?.length
    ? event.tags.reduce(
        (sum, tag) => sum + clamp(profile.interests[tag] ?? 0, -1, 1),
        0,
      ) / event.tags.length
    : 0
  const priorities = event.sourceLocators
    .map((source) => profile.subscriptionPriorities[source])
    .filter((value): value is number => value !== undefined)
  const priority = priorities.length
    ? clamp(Math.max(...priorities), -1, 1)
    : 0
  const favorite = profile.favorites.includes(event.id) ? 1 : 0
  const social = clamp((profile.remoteFavorites[event.id] ?? 0) / 4, 0, 1)
  return clamp((interests + priority + favorite + social) / 2, -1, 1)
}

export function scoreFreshness(
  event: ResolvedEvent,
  now: Date | string,
): number {
  const recordedAt = event.currentSchedule?.recordedAt
  if (!recordedAt) return 0
  const age = (new Date(now).getTime() - Date.parse(recordedAt)) / DAY
  return Number.isFinite(age) && age >= 0 && age < 30 ? 1 - age / 30 : 0
}

export function scoreExposure(
  exposure: ExposureSignal | undefined,
  daysUntil: number | null,
  lifecycle: EventLifecycle,
  now: Date | string,
  config: RecommendationConfigV2 = DEFAULT_MARKET_RECOMMENDATION_CONFIG,
): number {
  if (
    !exposure ||
    lifecycle === 'current' ||
    (daysUntil !== null && daysUntil <= 3)
  )
    return 0
  const age = Math.max(
    0,
    (new Date(now).getTime() - Date.parse(exposure.lastShownAt)) / DAY,
  )
  if (!Number.isFinite(age)) return 0
  const recency = 2 ** (-age / config.exposureHalfLifeDays)
  const repetition = 1 - Math.exp(-Math.max(0, exposure.shownCount) / 2)
  return config.exposurePenaltyCap * recency * repetition
}
