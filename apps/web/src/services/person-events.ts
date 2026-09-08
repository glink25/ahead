import type { UserData, Subscription } from '@ahead/schema'
import type { LoadedFeed } from '../lib/feed-loader'
import { parseLocator, sourceKey } from '@ahead/protocol'
import { PERSONAL_FEED } from '../data/model'
import { marketApi } from './market'
import type { AddressedEvent, ReadEvent } from './market-api'

export function observePersonEvents(user: UserData, receive: (state: { events: AddressedEvent[]; loading: boolean; error?: string }) => void) {
  const api = marketApi()
  const controller = new AbortController()
  const feeds = new Map<string, LoadedFeed>()
  let sources = new Set<string>()
  let failure: string | undefined
  const personal = user.extensions?.[PERSONAL_FEED] as Subscription | undefined
  let personalSource: string | undefined
  if (personal?.locator) {
    try { parseLocator(personal.locator); personalSource = sourceKey(personal) }
    catch { failure = 'messages.invalid_personal_feed_link' }
  }
  const publish = (error?: string) => {
    if (controller.signal.aborted) return
    if (error) failure = error
    const visible = new Set([...(user.favorites ?? []), ...(user.pins ?? [])])
    if (personalSource) for (const event of feeds.get(personalSource)?.feed.events ?? []) visible.add(event.id)
    receive({ events: api.events.resolve({ feeds: [...feeds.values()], users: [], activeProfile: user }).events.filter((event) => visible.has(event.id)), loading: false, error: failure })
  }
  const accept = (event: ReadEvent) => {
    if (event.type === 'feed' && sources.has(event.feed.sourceLocator)) { feeds.set(event.feed.sourceLocator, event.feed); publish() }
  }
  const unsubscribe = api.subscribe(accept)
  receive({ events: [], loading: true })
  void (async () => {
    const related = (await api.relatedSources(user)).filter((source) => source.kind !== 'user-data').slice(0, 40)
    sources = new Set(related.map(sourceKey))
    for await (const event of api.sources.read({ sources: related, signal: controller.signal })) {
      if (controller.signal.aborted) return
      if (event.type === 'error') publish(event.message)
      else accept(event)
    }
    publish()
  })().catch((error) => publish(String(error)))
  return () => { controller.abort(); unsubscribe() }
}
