import { assignBucket } from './buckets.js'
import { DEFAULT_MARKET_RECOMMENDATION_CONFIG } from './market-config.js'
import { rerankDiversity } from './market-diversity.js'
import { classifyLifecycle } from './market-lifecycle.js'
import {
  scoreAffinity,
  scoreExposure,
  scoreFreshness,
  scoreTemporalUrgency,
} from './market-score.js'
import type {
  MarketRecommendation,
  MarketRecommendOptions,
  RecommendationConfigV2,
} from './market-types.js'
import { daysUntilEvent } from './score.js'

export * from './market-config.js'
export * from './market-diversity.js'
export * from './market-lifecycle.js'
export * from './market-score.js'
export * from './market-types.js'

function randomFor(seed: string): () => number {
  let state = 2166136261
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 16777619)
  }
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Compose the independently testable recommendation stages into a stable list. */
export function composeRecommendation(
  options: MarketRecommendOptions,
): MarketRecommendation[] {
  const config: RecommendationConfigV2 = {
    ...DEFAULT_MARKET_RECOMMENDATION_CONFIG,
    ...options.config,
    version: 'v2',
  }
  const hidden = new Set(options.profile.hidden)
  const random = randomFor(options.seed)
  const primary: MarketRecommendation[] = []
  const past: MarketRecommendation[] = []

  for (const event of options.events) {
    if (
      hidden.has(event.id) ||
      event.status === 'archived' ||
      event.status === 'cancelled'
    )
      continue
    const lifecycle = classifyLifecycle(
      event,
      options.now,
      config.recentPastDays,
    )
    if (lifecycle === 'expired') continue
    const daysUntil = daysUntilEvent(event, options.now)
    const temporal = scoreTemporalUrgency(daysUntil, lifecycle, config)
    const affinity =
      scoreAffinity(event, options.profile) * config.affinityWeight
    const freshness = scoreFreshness(event, options.now) * config.freshnessWeight
    const exposure = scoreExposure(
      options.exposureFor?.(event),
      daysUntil,
      lifecycle,
      options.now,
      config,
    )
    const item: MarketRecommendation = {
      eventId: event.id,
      event,
      daysUntil,
      bucket: assignBucket(daysUntil),
      rank: 0,
      lifecycle,
      score: temporal + affinity + freshness - exposure + random() * 1e-6,
      components: {
        temporal,
        affinity,
        freshness,
        exposure,
        diversity: 0,
      },
    }
    ;(lifecycle === 'recent-past' ? past : primary).push(item)
  }

  const sort = (items: MarketRecommendation[]) =>
    rerankDiversity(
      items.sort(
        (left, right) =>
          right.score - left.score ||
          left.eventId.localeCompare(right.eventId),
      ),
      options.categoryFor,
      config,
    )
  const ranked = [
    ...sort(primary.filter((item) => item.lifecycle !== 'unknown')),
    ...sort(primary.filter((item) => item.lifecycle === 'unknown')),
  ]
  if (ranked.length < config.targetSize)
    ranked.push(
      ...sort(past).slice(0, config.targetSize - ranked.length),
    )
  return ranked.map((item, index) => ({ ...item, rank: index + 1 }))
}

/** Discover recommendations. Pure and deterministic for an input seed. */
export function recommendMarket(
  options: MarketRecommendOptions,
): MarketRecommendation[] {
  return composeRecommendation(options)
}
