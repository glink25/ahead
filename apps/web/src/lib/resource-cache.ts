import { database } from '../data/local'
import { workspaceRecords } from '@ahead/sync'
import { materializeProfile } from '../data/model'
import { sourceKey, parseSourceKey } from '@ahead/protocol'
import { resourceChanged } from '../services/resource-changes'
import type { EventFeed, UserData } from '@ahead/schema'
import { resourceStore, registerCacheEviction, type LocalStore } from '../data/storage'

export interface ResourceSnapshot<T> {
  value: T
  private: boolean
  version?: string
  storedAt: string
  lastAccessedAt: string
}

export interface CachedFeed {
  sourceLocator: string
  manifestPath: string
  version?: string
  complete?: boolean
  feed: EventFeed
  storedAt: string
  private?: boolean
}

const RESOURCE_LIMIT = 200

export class ResourceCache {
  private readonly store: LocalStore
  private ready: Promise<void>

  constructor(private identity: string) {
    this.store = resourceStore(identity)
    this.ready = identity === 'guest' ? Promise.resolve() : this.adoptPublicGuest()
    registerCacheEviction(identity, () => this.prune(true))
  }

  private async adoptPublicGuest() {
    const guest = resourceStore('guest')
    for (const key of await guest.keys()) {
      const snapshot = await guest.get<ResourceSnapshot<unknown>>(key)
      if (snapshot && !snapshot.private) await this.store.update<ResourceSnapshot<unknown>>(key, (current) => current ?? snapshot)
    }
  }

  async relatedSources(ids: Set<string>) {
    await this.ready
    const result = new Map<string, { locator: string; manifestPath?: string; kind: 'event-feed' }>()
    for (const key of await this.store.keys()) {
      if (!key.startsWith('feed:')) continue
      const cached = await this.store.get<ResourceSnapshot<CachedFeed>>(key)
      if (cached?.value.feed.events?.some((event) => ids.has(event.id))) result.set(cached.value.sourceLocator, { ...parseSourceKey(cached.value.sourceLocator), kind: 'event-feed' })
    }
    return [...result.values()]
  }

  private feedKey(sourceLocator: string, manifestPath: string) {
    return `feed:${sourceLocator}|${manifestPath}`
  }

  private userKey(sourceLocator: string) {
    return `user:${sourceLocator}`
  }

  async read(
    sourceLocator: string,
    manifestPath: string,
    version?: string,
  ): Promise<CachedFeed | undefined> {
    const cached = await this.readAny(sourceLocator, manifestPath)
    return cached && cached.complete !== false && (!version || cached.version === version) ? cached : undefined
  }

  async readAny(sourceLocator: string, manifestPath: string, eventId?: string): Promise<CachedFeed | undefined> {
    await this.ready
    try {
      const key = this.feedKey(sourceLocator, manifestPath)
      const complete = await this.store.get<ResourceSnapshot<CachedFeed>>(key)
      if (complete && !eventId) { void this.touch(key); return complete.value }
      const partialKeys = (await this.store.keys()).filter((candidate) => candidate.startsWith(key + ':partial:'))
      const partials = await Promise.all(partialKeys.map(async (key) => ({ key, snapshot: await this.store.get<ResourceSnapshot<CachedFeed>>(key) })))
      const candidates = [{ key, snapshot: complete }, ...partials].filter((item) => item.snapshot && (!eventId || item.snapshot.value.complete !== false || item.snapshot.value.feed.events?.some((event) => event.id === eventId)))
      candidates.sort((a, b) => (b.snapshot?.storedAt ?? '').localeCompare(a.snapshot?.storedAt ?? ''))
      const chosen = candidates[0]
      if (!chosen?.snapshot) return undefined
      void this.touch(chosen.key)
      return chosen.snapshot.value
    } catch {
      return undefined
    }
  }

  async write(entry: Omit<CachedFeed, 'storedAt'>): Promise<void> {
    await this.ready
    const now = new Date().toISOString()
    const key = this.feedKey(entry.sourceLocator, entry.manifestPath) + (entry.complete === false ? ':partial:' + encodeURIComponent(entry.version ?? '') : '')
    await this.store.update<ResourceSnapshot<CachedFeed>>(key, (previous) => {
      const old = previous?.value
      // Search returns a subset. Only combine subsets pinned to the same version.
      if (entry.complete === false && old && old.version === entry.version) {
        if (old.complete !== false) return { ...previous!, lastAccessedAt: now }
        entry = { ...entry, feed: { ...entry.feed, events: [...new Map([...(old.feed.events ?? []), ...(entry.feed.events ?? [])].map((event) => [event.id, event])).values()] } }
      }
      const value: CachedFeed = { ...entry, complete: entry.complete !== false, storedAt: now }
      return { value, private: Boolean(entry.private), storedAt: now, lastAccessedAt: now }
    })
    resourceChanged(this.identity, entry.sourceLocator)
    await this.prune()
  }

  deleteFeed(sourceLocator: string, manifestPath: string) {
    return this.store.delete(this.feedKey(sourceLocator, manifestPath))
  }

  async readUser(sourceLocator: string): Promise<UserData | undefined> {
    return (await this.readUserSnapshot(sourceLocator))?.value
  }

  async readUserSnapshot(sourceLocator: string): Promise<ResourceSnapshot<UserData> | undefined> {
    await this.ready
    try {
      const key = this.userKey(sourceLocator)
      const snapshot = await this.store.get<ResourceSnapshot<UserData>>(key)
      if (!snapshot) return undefined
      void this.touch(key)
      return snapshot
    } catch {
      return undefined
    }
  }

  async writeUser(sourceLocator: string, user: UserData, privateResource: boolean, version?: string) {
    await this.ready
    const now = new Date().toISOString()
    await this.store.set(this.userKey(sourceLocator), {
      value: user,
      private: privateResource,
      version,
      storedAt: now,
      lastAccessedAt: now,
    } satisfies ResourceSnapshot<UserData>)
    resourceChanged(this.identity, sourceLocator)
    await this.prune()
  }

  deleteUser(sourceLocator: string) {
    return this.store.delete(this.userKey(sourceLocator))
  }

  private async touch(key: string) {
    await this.store.update<ResourceSnapshot<unknown> | undefined>(key, (current) => current ? {
      ...current, lastAccessedAt: new Date().toISOString(),
    } : undefined).catch(() => {})
  }

  private async prune(force = false) {
    try {
      const keys = await this.store.keys()
      if (!force && keys.length <= RESOURCE_LIMIT) return
      const entries = await Promise.all(keys.map(async (key) => ({
        key,
        value: await this.store.get<ResourceSnapshot<unknown>>(key),
      })))
      const db = await database.query()
      const account = this.identity === 'guest' ? undefined : this.identity.slice(this.identity.lastIndexOf(':') + 1)
      const profiles = Object.values(db.spaces).filter((space) => space.account === account).map((space) => materializeProfile(workspaceRecords(space)))
      const protectedSources = new Set(profiles.flatMap((profile) => (profile.subscriptions ?? []).map(sourceKey)))
      const protectedEvents = new Set(profiles.flatMap((profile) => [...(profile.favorites ?? []), ...(profile.pins ?? [])]))
      const removable = entries.filter(({ key, value }) => {
        if (key.startsWith('user:')) return !protectedSources.has(key.slice(5))
        const feed = value?.value as CachedFeed | undefined
        return !feed || (!protectedSources.has(feed.sourceLocator) && !feed.feed.events?.some((event) => protectedEvents.has(event.id)))
      })
      removable.sort((left, right) =>
        (left.value?.lastAccessedAt ?? '').localeCompare(right.value?.lastAccessedAt ?? ''),
      )
      await Promise.all(removable.slice(0, force ? removable.length : Math.max(0, removable.length - RESOURCE_LIMIT)).map(({ key }) => this.store.delete(key)))
    } catch {
      /* Offline cache eviction is best effort. */
    }
  }
}
