import type { RepositoryAdapter, RepositorySnapshot } from '@ahead/core'
import type { EventFeed, UserData } from '@ahead/schema'
import { createValidator } from '@ahead/schema'
import { parseLocator, parseYaml, stringifyYaml } from '@ahead/protocol'
import {
  applyPatches,
  equal,
  recordsFromChanges,
  type Patch,
  type Records,
  type Space,
  type Target,
} from '@ahead/sync'
import { documentChanges, materializeProfile, eventFeed, profileCollections } from '../data/model'

export const feedCollections = new Set(['events', 'feed'])

export function locatorFor(target: Target) {
  const parsed = parseLocator(target.locator)
  if (parsed.scheme !== 'github' || !('owner' in parsed)) throw new Error('Unsupported sync provider')
  return parsed
}
export function httpStatus(error: unknown): number | undefined { return (error as { status?: number })?.status }

async function optionalRead(adapter: RepositoryAdapter, target: Target, path: string, ref: string) {
  try { return await adapter.readFile(locatorFor(target), path, { ref }) }
  catch (error) { if (httpStatus(error) === 404) return undefined; throw error }
}

export function checkedTarget(snapshot: RepositorySnapshot, target: Target) {
  if (snapshot.private !== target.private) throw new Error('messages.repository_visibility_changed_check_the_sync_destination')
  if (snapshot.writable === false) throw new Error('messages.no_write_access_to_this_repository')
  if (target.metadata?.repositoryId !== undefined && snapshot.repositoryId !== target.metadata.repositoryId)
    throw new Error('messages.the_sync_destination_changed_select_your_profile_again')
}

export async function readDocument(
  adapter: RepositoryAdapter,
  target: Target,
  kind: 'user-data' | 'event-feed',
  allowMissing = false,
) {
  const snapshot = await adapter.inspect(locatorFor(target))
  checkedTarget(snapshot, target)
  const file = await optionalRead(adapter, target, target.path, snapshot.headSha)
  if (!file && !allowMissing) throw new Error('messages.profile_file_not_found_nothing_was_written')
  const document = file ? parseYaml<UserData | EventFeed>(file.content) : undefined
  if (document && (!createValidator().validate(kind, document).ok || document.kind !== kind))
    throw new Error('messages.invalid_remote_content_nothing_was_written')
  return {
    snapshot,
    document,
    records: document ? recordsFromChanges(documentChanges(document)) : {} as Records,
  }
}

export async function syncDocument(
  adapter: RepositoryAdapter,
  target: Target,
  kind: 'user-data' | 'event-feed',
  space: Space,
  patches: Record<string, Patch>,
  allowMissing = false,
): Promise<{ records: Records; version: string }> {
  let conflict: unknown
  const collections = kind === 'user-data' ? profileCollections : feedCollections
  const relevant = Object.fromEntries(Object.entries(patches).filter(([, patch]) => collections.has(patch.collection)))
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await readDocument(adapter, target, kind, allowMissing)
    const merged = applyPatches(remote.records, relevant)
    const document = kind === 'user-data' ? materializeProfile(merged) : eventFeed(space, merged)
    if (!createValidator().validate(kind, document).ok) throw new Error('messages.invalid_merged_content_nothing_was_written')
    if (remote.document && equal(remote.document, document)) return { records: remote.records, version: remote.snapshot.headSha }
    try {
      const committed = await adapter.commitFiles({
        locator: locatorFor(target),
        branch: remote.snapshot.defaultBranch,
        expectedHeadSha: remote.snapshot.headSha,
        message: 'Sync Ahead ' + (kind === 'user-data' ? 'profile' : 'events'),
        files: [{ path: target.path, content: stringifyYaml(document) }],
      })
      return { records: recordsFromChanges(documentChanges(document)), version: committed.sha }
    } catch (error) {
      if (![409, 422].includes(httpStatus(error) ?? 0) && !String(error).includes('head changed')) throw error
      conflict = error
    }
  }
  throw conflict ?? new Error('messages.version_conflict_please_retry_later')
}
