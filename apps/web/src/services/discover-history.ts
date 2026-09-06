import type { ExposureSignal } from '@ahead/recommendation'
import { createIdbStore } from '../lib/idb'
import { useAuthSession } from '../stores'

type ExposureMap = Record<string, ExposureSignal>
const MAX_AGE = 180 * 86_400_000
let current: { identity: string; api: DiscoverHistory } | undefined

class DiscoverHistory {
  private readonly store
  private cache: ExposureMap = {}

  constructor(identity: string) {
    this.store = createIdbStore('ahead-discover-' + encodeURIComponent(identity), 'history')
  }

  async snapshot(): Promise<ExposureMap> {
    const now = Date.now()
    const stored = await this.store.get<ExposureMap>('exposures').catch(() => undefined)
    this.cache = Object.fromEntries(Object.entries(stored ?? {}).filter(([, value]) =>
      Number.isFinite(Date.parse(value.lastShownAt)) && now - Date.parse(value.lastShownAt) <= MAX_AGE,
    ))
    return { ...this.cache }
  }

  async record(eventId: string): Promise<ExposureMap> {
    const previous = this.cache[eventId]
    this.cache = {
      ...this.cache,
      [eventId]: {
        shownCount: (previous?.shownCount ?? 0) + 1,
        lastShownAt: new Date().toISOString(),
      },
    }
    await this.store.set('exposures', this.cache).catch(() => {})
    return { ...this.cache }
  }
}

export function discoverHistory() {
  const session = useAuthSession.getState().session
  const identity = session ? `${session.providerId}:${session.identity.id}` : 'guest'
  if (current?.identity !== identity) current = { identity, api: new DiscoverHistory(identity) }
  return current.api
}
