import { expect, it } from 'vitest'
import type { ResolvedEvent } from '@ahead/resolver'
import { primaryFeedForEvent } from './primary-feed'

const event = (provenance: ResolvedEvent['provenance']): Pick<ResolvedEvent, 'sourceLocators' | 'provenance'> => ({
  sourceLocators: ['github:z/feed', 'github:a/feed'],
  provenance,
})
const feeds = [
  { sourceLocator: 'github:a/feed' },
  { sourceLocator: 'github:z/feed' },
]

it('uses the source that won the event merge', () => {
  expect(primaryFeedForEvent(event([
    { field: 'id', sourceLocator: 'github:z/feed', reason: 'initial' },
    { field: 'id', sourceLocator: 'github:a/feed', reason: 'deduplicated' },
  ]), feeds)?.sourceLocator).toBe('github:z/feed')
})

it('falls back deterministically and ignores unrelated feeds', () => {
  expect(primaryFeedForEvent(event([]), [
    { sourceLocator: 'github:z/feed' },
    { sourceLocator: 'github:unrelated/feed' },
    { sourceLocator: 'github:a/feed' },
  ])?.sourceLocator).toBe('github:a/feed')
})
