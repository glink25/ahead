export const BUCKET_IDS = [
  '0-7d',
  '7-30d',
  '1-3m',
  '3-12m',
  '1y+',
  'unknown',
] as const

export type RecommendationBucket = (typeof BUCKET_IDS)[number]

export interface RecommendationConfig {
  version: 'v1'
  favoriteBoost: number
  remoteFavoriteWeight: number
  remoteFavoriteCap: number
  interestWeight: number
  priorityWeight: number
  noveltyWeight: number
  noveltyDays: number
  /** Extra score when now is inside [start, end). */
  ongoingBoost: number
  buckets: ReadonlyArray<{
    id: RecommendationBucket
    minDays: number | null
    maxDays: number | null
  }>
}

export const DEFAULT_RECOMMENDATION_CONFIG = Object.freeze({
  version: 'v1',
  favoriteBoost: 5,
  remoteFavoriteWeight: 0.25,
  remoteFavoriteCap: 1,
  interestWeight: 1,
  priorityWeight: 1,
  noveltyWeight: 1,
  noveltyDays: 30,
  ongoingBoost: 2,
  buckets: [
    { id: '0-7d', minDays: 0, maxDays: 7 },
    { id: '7-30d', minDays: 7, maxDays: 30 },
    { id: '1-3m', minDays: 30, maxDays: 90 },
    { id: '3-12m', minDays: 90, maxDays: 365 },
    { id: '1y+', minDays: 365, maxDays: null },
    { id: 'unknown', minDays: null, maxDays: null },
  ],
} satisfies RecommendationConfig)
