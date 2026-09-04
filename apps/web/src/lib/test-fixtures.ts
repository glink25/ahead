import type { Event, EventFeed, TemporalValue } from '@ahead/schema'
import type { ResolvedEvent } from '@ahead/resolver'
export const event = (id = 'test', value: TemporalValue = { kind: 'exact', date: '2027-01-10' }): Event => ({
  id, title: { 'zh-CN': id }, schedule: [{ id: 'initial', value, recordedAt: '2025-01-01T00:00:00Z' }],
})
export const feed = (events = [event()]): EventFeed => ({ oefVersion: '0.1', kind: 'event-feed', id: 'test-feed', name: { 'zh-CN': '测试源' }, events })
export const resolvedEvent = (id = 'test', value?: TemporalValue): ResolvedEvent => ({
  ...event(id, value), sourceLocators: ['github:test/repo'], provenance: [],
})
