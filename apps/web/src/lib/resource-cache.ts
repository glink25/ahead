import type { EventFeed, UserData } from '@ahead/schema'
import { resourceStore, type LocalStore } from '../data/storage'

export interface ResourceSnapshot<T> {
  value: T
  private: boolean
  storedAt: string
  lastAccessedAt: string
}

interface CachedFeed {
  sourceLocator: string
  manifestPath: string
  headSha?: string
  feed: EventFeed
  storedAt: string
  private?: boolean
}

const RESOURCE_LIMIT = 200

export class ResourceCache {
  private readonly store: LocalStore

  constructor(identity: string) {
    this.store = resourceStore(identity)
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
    headSha?: string,
  ): Promise<CachedFeed | undefined> {
    const cached = await this.readAny(sourceLocator, manifestPath)
    return cached && (!headSha || cached.headSha === headSha) ? cached : undefined
  }

  async readAny(sourceLocator: string, manifestPath: string): Promise<CachedFeed | undefined> {
    try {
      const key = this.feedKey(sourceLocator, manifestPath)
      const snapshot = await this.store.get<ResourceSnapshot<CachedFeed>>(key)
      if (!snapshot) return undefined
      void this.touch(key, snapshot)
      return snapshot.value
    } catch {
      return undefined
    }
  }

  async write(entry: Omit<CachedFeed, 'storedAt'>): Promise<void> {
    const now = new Date().toISOString()
    const value: CachedFeed = { ...entry, storedAt: now }
    await this.store.set(this.feedKey(entry.sourceLocator, entry.manifestPath), {
      value,
      private: Boolean(entry.private),
      storedAt: now,
      lastAccessedAt: now,
    } satisfies ResourceSnapshot<CachedFeed>)
    void this.prune()
  }

  deleteFeed(sourceLocator: string, manifestPath: string) {
    return this.store.delete(this.feedKey(sourceLocator, manifestPath))
  }

  async readUser(sourceLocator: string): Promise<UserData | undefined> {
    return (await this.readUserSnapshot(sourceLocator))?.value
  }

  async readUserSnapshot(sourceLocator: string): Promise<ResourceSnapshot<UserData> | undefined> {
    try {
      const key = this.userKey(sourceLocator)
      const snapshot = await this.store.get<ResourceSnapshot<UserData>>(key)
      if (!snapshot) return undefined
      void this.touch(key, snapshot)
      return snapshot
    } catch {
      return undefined
    }
  }

  async writeUser(sourceLocator: string, user: UserData, privateResource: boolean) {
    const now = new Date().toISOString()
    await this.store.set(this.userKey(sourceLocator), {
      value: user,
      private: privateResource,
      storedAt: now,
      lastAccessedAt: now,
    } satisfies ResourceSnapshot<UserData>)
    void this.prune()
  }

  deleteUser(sourceLocator: string) {
    return this.store.delete(this.userKey(sourceLocator))
  }

  private async touch<T>(key: string, snapshot: ResourceSnapshot<T>) {
    await this.store.set(key, {
      ...snapshot,
      lastAccessedAt: new Date().toISOString(),
    }).catch(() => {})
  }

  private async prune() {
    try {
      const keys = await this.store.keys()
      if (keys.length <= RESOURCE_LIMIT) return
      const entries = await Promise.all(keys.map(async (key) => ({
        key,
        value: await this.store.get<ResourceSnapshot<unknown>>(key),
      })))
      entries.sort((left, right) =>
        (left.value?.lastAccessedAt ?? '').localeCompare(right.value?.lastAccessedAt ?? ''),
      )
      await Promise.all(entries.slice(0, keys.length - RESOURCE_LIMIT).map(({ key }) => this.store.delete(key)))
    } catch {
      /* Offline cache eviction is best effort. */
    }
  }
}
