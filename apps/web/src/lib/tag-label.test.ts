import { expect, test } from 'vitest'
import type { LoadedFeed } from './feed-loader'
import { tagLabel } from './tag-label'

const source = (sourceLocator: string, zh = '观星'): Pick<LoadedFeed, 'sourceLocator' | 'feed'> => ({
  sourceLocator,
  feed: { oefVersion: '0.1', kind: 'event-feed', id: 'sky', name: { en: 'Sky' },
    tags: [{ id: 'astronomy', label: { 'zh-CN': zh, en: 'Astronomy' } }] },
})

test('localizes labels while leaving interest IDs intact', () => {
  const event = { sourceLocators: ['a'], tags: ['astronomy'] }
  expect(tagLabel(event.tags[0]!, event, [source('a')], 'zh-CN')).toBe('观星')
  expect(tagLabel(event.tags[0]!, event, [source('a')], 'en')).toBe('Astronomy')
  expect(event.tags).toEqual(['astronomy'])
})

test('only uses event sources and falls back to the ID', () => {
  expect(tagLabel('astronomy', { sourceLocators: ['b'] }, [source('a')], 'en')).toBe('astronomy')
  expect(tagLabel('unknown', { sourceLocators: ['a'] }, [source('a')], 'en')).toBe('unknown')
  const feed = source('a')
  feed.feed.tags = [{ id: 'astronomy' }]
  expect(tagLabel('astronomy', { sourceLocators: ['a'] }, [feed], 'en')).toBe('astronomy')
})

test('source conflicts resolve consistently without reordering store data', () => {
  const feeds = [source('z', '天文'), source('a', '观星')]
  const event = { sourceLocators: ['z', 'a'] }
  expect(tagLabel('astronomy', event, feeds, 'zh-CN')).toBe('观星')
  expect(tagLabel('astronomy', event, [...feeds].reverse(), 'zh-CN')).toBe('观星')
  expect(feeds.map((feed) => feed.sourceLocator)).toEqual(['z', 'a'])
})
