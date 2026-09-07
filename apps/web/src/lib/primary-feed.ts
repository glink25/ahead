import type { ResolvedEvent } from '@ahead/resolver'
import type { LoadedFeed } from './feed-loader'

/**
 * Pick the single source that owns an event's presentation in a feed view.
 *
 * The resolver keeps every matching source for provenance and scoring. Prefer
 * the source whose event won the deterministic merge so the visible channel,
 * artwork and merged content stay aligned.
 */
export function primaryFeedForEvent<T extends Pick<LoadedFeed, 'sourceLocator'>>(
  event: Pick<ResolvedEvent, 'sourceLocators' | 'provenance'>,
  feeds: readonly T[],
): T | undefined {
  const candidates = new Map(
    feeds
      .filter((feed) => event.sourceLocators.includes(feed.sourceLocator))
      .map((feed) => [feed.sourceLocator, feed]),
  )
  const initialSource = event.provenance.find(
    (item) =>
      item.field === 'id' &&
      item.reason === 'initial' &&
      candidates.has(item.sourceLocator),
  )?.sourceLocator
  if (initialSource) return candidates.get(initialSource)

  const source = [...candidates.keys()].sort()[0]
  return source ? candidates.get(source) : undefined
}
