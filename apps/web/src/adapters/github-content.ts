import { CdnReadAdapter, buildJsDelivrUrl } from '@ahead/github'
import type { RepositoryAdapter } from '@ahead/core'
import { parseLocator, parseYaml, manifestPath, sourceKey } from '@ahead/protocol'
import { createValidator, type UserData } from '@ahead/schema'
import { fetchFeed } from '../lib/feed-loader'
import type { ContentProvider, Source } from '../services/providers'
import type { PublicReadClient } from '../services/public-read-client'

export class GitHubContentProvider implements ContentProvider {
  readonly scheme = 'github'
  constructor(private client: PublicReadClient, private authenticated?: RepositoryAdapter) {}
  private pending = new Map<string, Promise<import('../services/providers').ContentResult>>()
  read(source: Source, options: { version?: string; signal?: AbortSignal; refresh?: boolean }) {
    const key = JSON.stringify([source.kind, sourceKey(source), options.version ?? ''])
    const previous = this.pending.get(key)
    if (previous) return previous
    const result = this.load(source, { ...options, signal: undefined }).finally(() => this.pending.delete(key))
    this.pending.set(key, result)
    return result
  }
  private async load(source: Source, options: { version?: string; signal?: AbortSignal; refresh?: boolean }) {
    const locator = parseLocator(source.locator)
    if (locator.scheme !== 'github' || !('owner' in locator)) throw new Error('Unsupported content provider')
    const adapter = this.authenticated ?? new CdnReadAdapter(this.client.fetch(options))
    const snapshot = await adapter.inspect(locator)
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (options.version === snapshot.headSha) return { version: snapshot.headSha, private: snapshot.private }
    const path = manifestPath(source.manifestPath)
    if (source.kind === 'user-data') {
      const file = await adapter.readFile(locator, path, { ref: snapshot.headSha })
      const document = parseYaml<UserData>(file.content)
      if (!createValidator().validate('user-data', document).ok) throw new Error('messages.profile_validation_failed')
      return { document, version: snapshot.headSha, private: snapshot.private }
    }
    const feed = await fetchFeed({ ...source, adapter, snapshot, allowPrivate: snapshot.private })
    return { document: feed.feed, version: snapshot.headSha, private: snapshot.private }
  }
  mediaUrl(source: Source, version: string | undefined, path: string) {
    return githubMediaUrl(source, version, path)
  }
}
export function githubMediaUrl(source: Source, version: string | undefined, path: string) {
  const locator = parseLocator(source.locator)
  if (locator.scheme !== 'github' || !('owner' in locator)) return undefined
  return buildJsDelivrUrl(locator, version ?? 'HEAD', path)
}
