import type { EventFeed } from '@ahead/schema'
import { createIdbStore, type KeyValueStore } from './idb'

interface CachedFeed {
  sourceLocator: string
  manifestPath: string
  headSha?: string
  feed: EventFeed
  storedAt: string
}

/**
 * Caches parsed feeds so a warm start renders instantly and an offline start
 * still shows last-known content (manual sections 34 and 35).
 *
 * Keyed by commit when known, so a pinned entry is never stale; the unpinned
 * key is overwritten on every read because it tracks a moving branch.
 */
export class RepoCache {
  constructor(private readonly store: KeyValueStore = createIdbStore('ahead-repo-cache', 'feeds')) {}

  private key(sourceLocator: string, manifestPath: string, headSha?: string): string {
    return `${sourceLocator}|${manifestPath}|${headSha ?? 'unpinned'}`
  }

  async read(
    sourceLocator: string,
    manifestPath: string,
    headSha?: string,
  ): Promise<CachedFeed | undefined> {
    try {
      return await this.store.get<CachedFeed>(this.key(sourceLocator, manifestPath, headSha))
    } catch {
      return undefined
    }
  }

  async write(entry: Omit<CachedFeed, 'storedAt'>): Promise<void> {
    try {
      await this.store.set(this.key(entry.sourceLocator, entry.manifestPath, entry.headSha), {
        ...entry,
        storedAt: new Date().toISOString(),
      })
    } catch {
      // A full or unavailable IndexedDB must not break rendering.
    }
  }

  /** Any cached copy of this manifest, newest first. Used when the network fails. */
  async readAny(sourceLocator: string, manifestPath: string): Promise<CachedFeed | undefined> {
    try {
      const prefix = `${sourceLocator}|${manifestPath}|`
      const keys = (await this.store.keys()).filter((key) => key.startsWith(prefix))
      const entries: CachedFeed[] = []
      for (const key of keys) {
        const entry = await this.store.get<CachedFeed>(key)
        if (entry) entries.push(entry)
      }
      entries.sort((left, right) => right.storedAt.localeCompare(left.storedAt))
      return entries[0]
    } catch {
      return undefined
    }
  }
}
