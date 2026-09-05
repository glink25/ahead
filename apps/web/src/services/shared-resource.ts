import { CdnReadAdapter } from '@ahead/github'
import type { RepositoryAdapter } from '@ahead/core'
import { createValidator, type UserData } from '@ahead/schema'
import { parseLocator, parseSourceKey, parseYaml, sourceKey } from '@ahead/protocol'
import { authenticatedAdapter } from '../lib/auth'
import { fetchFeed, type LoadedFeed } from '../lib/feed-loader'
import { useAuthSession } from '../stores'

export type SharedSource = ReturnType<typeof parseSourceKey>
export type SharedResource =
  | { kind: 'event-feed'; source: SharedSource; private: boolean; feed: LoadedFeed }
  | { kind: 'user-data'; source: SharedSource; private: boolean; user: UserData }

export class SharedResourceError extends Error {
  constructor(
    message: string,
    readonly reason: 'invalid' | 'auth' | 'missing' | 'unavailable',
  ) {
    super(message)
    this.name = 'SharedResourceError'
  }
}

function githubSource(key: string) {
  const source = parseSourceKey(key)
  const locator = parseLocator(source.locator)
  if (!('owner' in locator)) throw new TypeError('Unsupported source locator')
  return { source, locator }
}

/** Read a link target without ever persisting private repository content. */
export async function loadSharedResource(
  key: string,
  kind: 'event-feed' | 'user-data',
  signal?: AbortSignal,
): Promise<SharedResource> {
  let parsed: ReturnType<typeof githubSource>
  try {
    parsed = githubSource(key)
  } catch (error) {
    throw new SharedResourceError(String(error), 'invalid')
  }
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
  const publicAdapter = new CdnReadAdapter()
  const session = useAuthSession.getState().session
  let snapshot
  let adapter: RepositoryAdapter = publicAdapter
  try {
    snapshot = await publicAdapter.inspect(parsed.locator)
  } catch (publicError) {
    if (!session)
      throw new SharedResourceError(String(publicError), 'auth')
    adapter = authenticatedAdapter(session)
    try {
      snapshot = await adapter.inspect(parsed.locator)
    } catch (error) {
      throw new SharedResourceError(String(error), 'missing')
    }
  }
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
  if (snapshot.private) {
    if (!session) throw new SharedResourceError('Sign-in required', 'auth')
    adapter = authenticatedAdapter(session)
  }
  try {
    if (kind === 'event-feed') {
      const feed = await fetchFeed({
        ...parsed.source,
        adapter,
        ref: snapshot.headSha,
        allowPrivate: snapshot.private,
      })
      return { kind, source: parsed.source, private: snapshot.private, feed }
    }
    const file = await adapter.readFile(
      parsed.locator,
      parsed.source.manifestPath ?? 'ahead.yaml',
      { ref: snapshot.headSha },
    )
    const user = parseYaml<UserData>(file.content)
    if (!createValidator().validate('user-data', user).ok)
      throw new Error('messages.profile_validation_failed')
    return { kind, source: parsed.source, private: snapshot.private, user }
  } catch (error) {
    if (error instanceof SharedResourceError) throw error
    throw new SharedResourceError(String(error), 'unavailable')
  }
}

export function sharedSourceKey(source: SharedSource) {
  return sourceKey(source)
}
