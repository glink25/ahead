import type { ResolvedEvent } from '@ahead/resolver'
import { recommend, type Recommendation, type RecommendOptions } from './recommend.js'
import { eventEndedAt } from './score.js'

export interface MarketRecommendOptions extends RecommendOptions {
  seed: string
  categoryFor: (event: ResolvedEvent) => string
  recentPastDays?: number
}

function randomFor(seed: string): () => number {
  let state = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
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

function categoryWeight(items: readonly Recommendation[], interests: Readonly<Record<string, number>>): number {
  if (!items.length) return 1
  const affinity = items.reduce(
    (total, item) =>
      total + (item.event.tags ?? []).reduce((sum, tag) => sum + (interests[tag] ?? 0), 0),
    0,
  ) / items.length
  return Math.exp(Math.max(-2, Math.min(2, affinity)))
}

function diversify(
  items: readonly Recommendation[],
  options: Pick<MarketRecommendOptions, 'seed' | 'categoryFor' | 'profile'>,
): Recommendation[] {
  const groups = new Map<string, Recommendation[]>()
  for (const item of items) {
    const category = options.categoryFor(item.event)
    const group = groups.get(category) ?? []
    group.push(item)
    groups.set(category, group)
  }
  const weights = new Map(
    [...groups].map(([category, group]) => [category, categoryWeight(group, options.profile.interests)]),
  )
  const random = randomFor(options.seed)
  const recent: string[] = []
  const result: Recommendation[] = []

  while (result.length < items.length) {
    const available = [...groups.keys()].filter((category) => groups.get(category)!.length > 0).sort()
    const cooldown = available.length >= 3 ? 2 : available.length === 2 ? 1 : 0
    let candidates = available.filter((category) => !recent.slice(-cooldown).includes(category))
    if (!candidates.length) candidates = available
    const total = candidates.reduce((sum, category) => sum + weights.get(category)!, 0)
    let draw = random() * total
    let selected = candidates[candidates.length - 1]!
    for (const category of candidates) {
      draw -= weights.get(category)!
      if (draw <= 0) {
        selected = category
        break
      }
    }
    result.push(groups.get(selected)!.shift()!)
    recent.push(selected)
  }
  return result
}

/** Market-only recommendations: future-first, lightly nostalgic, and category-diverse. */
export function recommendMarket(options: MarketRecommendOptions): Recommendation[] {
  const now = new Date(options.now)
  const recentPastDays = options.recentPastDays ?? 7
  const main: ResolvedEvent[] = []
  const recentPast: ResolvedEvent[] = []

  for (const event of options.events) {
    const endedAt = eventEndedAt(event, now)
    if (!endedAt) {
      main.push(event)
      continue
    }
    const age = (now.getTime() - endedAt.getTime()) / 86_400_000
    if (age <= recentPastDays) recentPast.push(event)
  }

  const base = { profile: options.profile, now, config: options.config }
  const primary = diversify(recommend({ ...base, events: main }), options)
  const pastLimit = Math.min(recentPast.length, Math.floor(primary.length / 9))
  const past = diversify(recommend({ ...base, events: recentPast }), {
    ...options,
    seed: `${options.seed}:past`,
  }).slice(0, pastLimit)

  const result: Recommendation[] = []
  let pastIndex = 0
  for (let index = 0; index < primary.length; index += 1) {
    result.push(primary[index]!)
    if ((index + 1) % 9 === 0 && pastIndex < past.length) {
      const previousCategory = options.categoryFor(primary[index]!.event)
      const nextCategory = primary[index + 1] ? options.categoryFor(primary[index + 1]!.event) : undefined
      const swapIndex = past.findIndex((item, candidateIndex) =>
        candidateIndex >= pastIndex &&
        options.categoryFor(item.event) !== previousCategory &&
        options.categoryFor(item.event) !== nextCategory,
      )
      if (swapIndex > pastIndex) [past[pastIndex], past[swapIndex]] = [past[swapIndex]!, past[pastIndex]!]
      result.push(past[pastIndex++]!)
    }
  }
  return result.map((item, index) => ({ ...item, rank: index + 1 }))
}
