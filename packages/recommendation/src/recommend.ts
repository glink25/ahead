import type { ResolvedEvent, ResolvedProfile } from '@ahead/resolver'
import { assignBucket } from './buckets.js'
import {
  BUCKET_IDS,
  DEFAULT_RECOMMENDATION_CONFIG,
  type RecommendationBucket,
  type RecommendationConfig,
} from './config.js'
import { daysUntilEvent, scoreEvent } from './score.js'

export interface Recommendation {
  eventId: string
  event: ResolvedEvent
  score: number
  bucket: RecommendationBucket
  daysUntil: number | null
  rank: number
}

export interface RecommendOptions {
  events: readonly ResolvedEvent[]
  profile: ResolvedProfile
  now: Date | string
  config?: Partial<RecommendationConfig>
}

export function recommend({
  events,
  profile,
  now,
  config: overrides,
}: RecommendOptions): Recommendation[] {
  const config: RecommendationConfig = {
    ...DEFAULT_RECOMMENDATION_CONFIG,
    ...overrides,
    buckets: overrides?.buckets ?? DEFAULT_RECOMMENDATION_CONFIG.buckets,
    version: 'v1',
  }
  const hidden = new Set(profile.hidden)
  const groups = new Map<RecommendationBucket, Recommendation[]>(
    BUCKET_IDS.map((bucket) => [bucket, []]),
  )

  for (const event of events) {
    if (hidden.has(event.id) || event.status === 'archived' || event.status === 'cancelled') continue
    const daysUntil = daysUntilEvent(event, now)
    const bucket = assignBucket(daysUntil, config)
    groups.get(bucket)!.push({
      eventId: event.id,
      event,
      score: scoreEvent(event, { profile, now, config }),
      bucket,
      daysUntil,
      rank: 0,
    })
  }

  for (const group of groups.values()) {
    group.sort((a, b) => b.score - a.score || a.eventId.localeCompare(b.eventId))
  }

  const result: Recommendation[] = []
  for (let index = 0; ; index += 1) {
    let added = false
    for (const bucket of BUCKET_IDS) {
      const item = groups.get(bucket)?.[index]
      if (item) {
        result.push({ ...item, rank: result.length + 1 })
        added = true
      }
    }
    if (!added) break
  }
  return result
}
