import {
  DEFAULT_RECOMMENDATION_CONFIG,
  type RecommendationBucket,
  type RecommendationConfig,
} from './config.js'

export function assignBucket(
  daysUntil: number | null,
  config: RecommendationConfig = DEFAULT_RECOMMENDATION_CONFIG,
): RecommendationBucket {
  if (daysUntil === null || !Number.isFinite(daysUntil)) return 'unknown'
  const days = Math.max(0, daysUntil)
  return (
    config.buckets.find(
      ({ id, minDays, maxDays }) =>
        id !== 'unknown' &&
        minDays !== null &&
        days >= minDays &&
        (maxDays === null || days < maxDays),
    )?.id ?? 'unknown'
  )
}
