import type { ResolvedEvent } from '@ahead/resolver'
import { DEFAULT_MARKET_RECOMMENDATION_CONFIG } from './market-config.js'
import type {
  MarketRecommendation,
  RecommendationConfigV2,
} from './market-types.js'

function similarity(left: ResolvedEvent, right: ResolvedEvent): number {
  const a = new Set(left.tags ?? [])
  const b = new Set(right.tags ?? [])
  if (!a.size || !b.size) return 0
  const overlap = [...a].filter((tag) => b.has(tag)).length
  return overlap / new Set([...a, ...b]).size
}

export function rerankDiversity(
  input: readonly MarketRecommendation[],
  categoryFor: (event: ResolvedEvent) => string,
  config: RecommendationConfigV2 = DEFAULT_MARKET_RECOMMENDATION_CONFIG,
): MarketRecommendation[] {
  const remaining = [...input]
  const result: MarketRecommendation[] = []
  while (remaining.length) {
    const previous = result.at(-1)
    let selectedIndex = 0
    let selectedScore = -Infinity
    let selectedPenalty = 0
    for (let index = 0; index < remaining.length; index++) {
      const item = remaining[index]!
      let penalty = 0
      if (
        previous &&
        categoryFor(previous.event) === categoryFor(item.event)
      )
        penalty += config.sourcePenalty
      if (previous && similarity(previous.event, item.event) >= 0.6)
        penalty += config.similarityPenalty
      const adjusted = item.score - penalty
      if (
        adjusted > selectedScore ||
        (adjusted === selectedScore &&
          item.eventId.localeCompare(remaining[selectedIndex]!.eventId) < 0)
      ) {
        selectedIndex = index
        selectedScore = adjusted
        selectedPenalty = penalty
      }
    }
    const [selected] = remaining.splice(selectedIndex, 1)
    result.push({
      ...selected!,
      components: {
        ...selected!.components,
        diversity: selectedPenalty,
      },
    })
  }
  return result
}
