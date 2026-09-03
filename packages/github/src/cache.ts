import type { ResourceLocator } from '@ahead/core'

export function createCacheKey(locator: ResourceLocator, sha: string, path: string): string {
  return [
    locator.owner.toLowerCase(),
    locator.repo.toLowerCase(),
    sha,
    path.replace(/^\/+/, ''),
  ].map(encodeURIComponent).join(':')
}

export class MemoryCache<T> {
  private readonly entries = new Map<string, T>()

  get(locator: ResourceLocator, sha: string, path: string): T | undefined {
    return this.entries.get(createCacheKey(locator, sha, path))
  }

  set(locator: ResourceLocator, sha: string, path: string, value: T): void {
    this.entries.set(createCacheKey(locator, sha, path), value)
  }

  delete(locator: ResourceLocator, sha: string, path: string): boolean {
    return this.entries.delete(createCacheKey(locator, sha, path))
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
