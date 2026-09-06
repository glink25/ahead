import type { ResolvedEvent, ResolvedProfile } from '@ahead/resolver'
import type { Recommendation } from './recommend.js'

export interface ExposureSignal {
  shownCount: number
  lastShownAt: string
}

export interface RecommendationConfigV2 {
  version: 'v2'
  temporalWeight: number
  affinityWeight: number
  freshnessWeight: number
  urgencyHalfLifeDays: number
  currentBoost: number
  exposurePenaltyCap: number
  exposureHalfLifeDays: number
  sourcePenalty: number
  similarityPenalty: number
  recentPastDays: number
  targetSize: number
}

export type EventLifecycle =
  | 'current'
  | 'future'
  | 'unknown'
  | 'recent-past'
  | 'expired'

export interface MarketRecommendation extends Recommendation {
  lifecycle: EventLifecycle
  components: {
    temporal: number
    affinity: number
    freshness: number
    exposure: number
    diversity: number
  }
}

export interface MarketRecommendOptions {
  events: readonly ResolvedEvent[]
  profile: ResolvedProfile
  now: Date | string
  seed: string
  categoryFor: (event: ResolvedEvent) => string
  exposureFor?: (event: ResolvedEvent) => ExposureSignal | undefined
  config?: Partial<RecommendationConfigV2>
}
