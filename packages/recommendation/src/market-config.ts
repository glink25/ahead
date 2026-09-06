import type { RecommendationConfigV2 } from './market-types.js'

export const DEFAULT_MARKET_RECOMMENDATION_CONFIG = Object.freeze({
  version: 'v2',
  temporalWeight: 0.75,
  affinityWeight: 0.2,
  freshnessWeight: 0.05,
  urgencyHalfLifeDays: 60,
  currentBoost: 0.25,
  exposurePenaltyCap: 0.15,
  exposureHalfLifeDays: 30,
  sourcePenalty: 0.05,
  similarityPenalty: 0.03,
  recentPastDays: 7,
  targetSize: 20,
} satisfies RecommendationConfigV2)
