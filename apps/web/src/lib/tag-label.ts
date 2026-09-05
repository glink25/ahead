import type { ResolvedEvent } from '@ahead/resolver'
import type { LoadedFeed } from './feed-loader'
import { pickText } from './format'

/** Labels belong to the event's sources; IDs remain the recommendation keys. */
export function tagLabel(
  id: string,
  event: Pick<ResolvedEvent, 'sourceLocators'>,
  feeds: Pick<LoadedFeed, 'sourceLocator' | 'feed'>[],
  locale?: string,
): string {
  const sources = new Set(event.sourceLocators)
  for (const source of feeds
    .filter((feed) => sources.has(feed.sourceLocator))
    .sort((a, b) => a.sourceLocator < b.sourceLocator ? -1 : a.sourceLocator > b.sourceLocator ? 1 : 0)) {
    const label = pickText(source.feed.tags?.find((tag) => tag.id === id)?.label, locale)
    if (label.trim()) return label
  }
  return id
}
