import type { RepositoryAdapter, RepositorySnapshot } from '@ahead/core'
import type { EventFeed, UserData } from '@ahead/schema'
import { createValidator } from '@ahead/schema'
import { parseYaml, stringifyYaml } from '@ahead/protocol'
import {
  applyChanges,
  entries,
  equal,
  mergeRecords,
  newDatabase,
  newSpace,
  parseEnvelope,
  recordKey,
  type Records,
  type Space,
  type Target,
  type RemoteEnvelope,
} from '@ahead/sync'
import {
  documentChanges,
  diffRecords,
  materializeProfile,
  eventFeed,
  profileCollections,
} from './model'
export const locatorFor = (t: Target) => ({
  scheme: 'github',
  owner: t.owner,
  repo: t.repo,
})
export const metadataPath = (path: string) =>
  '.ahead/' + encodeURIComponent(path) + '.sync.json'
export function httpStatus(error: unknown): number | undefined {
  return (error as { status?: number })?.status
}
async function optionalRead(
  adapter: RepositoryAdapter,
  target: Target,
  path: string,
  ref: string,
) {
  try {
    return await adapter.readFile(locatorFor(target), path, { ref })
  } catch (error) {
    if (httpStatus(error) === 404) return undefined
    throw error
  }
}
export function checkedTarget(snapshot: RepositorySnapshot, target: Target) {
  if (snapshot.private !== target.private)
    throw new Error('messages.repository_visibility_changed_check_the_sync_destination')
  if (snapshot.writable === false) throw new Error('messages.no_write_access_to_this_repository')
  if (
    target.repositoryId !== undefined &&
    snapshot.repositoryId !== target.repositoryId
  )
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
  const file = await optionalRead(
    adapter,
    target,
    target.path,
    snapshot.headSha,
  )
  if (!file && !allowMissing) throw new Error('messages.profile_file_not_found_nothing_was_written')
  const document = file
    ? parseYaml<UserData | EventFeed>(file.content)
    : undefined
  if (
    document &&
    (!createValidator().validate(kind, document).ok || document.kind !== kind)
  )
    throw new Error('messages.invalid_remote_content_nothing_was_written')
  const meta = await optionalRead(
    adapter,
    target,
    metadataPath(target.path),
    snapshot.headSha,
  )
  const envelope = meta ? parseEnvelope(JSON.parse(meta.content)) : undefined
  const collections =
    kind === 'user-data' ? profileCollections : new Set(['events', 'feed'])
  if (
    envelope &&
    Object.values(envelope.records).some((r) => !collections.has(r.collection))
  )
    throw new Error('messages.sync_metadata_contains_mismatched_collections')
  let records = envelope?.records ?? {}
  if (document) {
    const baseline = envelope?.projection
      ? documentChanges(envelope.projection as UserData | EventFeed)
      : []
    const base: Records = {}
    for (const v of baseline)
      base[recordKey(v.collection, v.key)] = {
        ...v,
        deleted: false,
        history: [],
        operation: 'baseline',
        revision: { time: 0, counter: 0, device: '' },
      }
    const changes = diffRecords(base, documentChanges(document), collections)
    if (changes.length) {
      const db = newDatabase(),
        space = newSpace('remote', 'remote')
      db.device = 'git-' + snapshot.headSha
      space.records = structuredClone(records)
      // Existing manifests without metadata are a baseline, not a new edit.
      applyChanges(
        db,
        space,
        changes,
        envelope ? Date.parse(snapshot.committedAt ?? '') || Date.now() : 0,
      )
      for (const c of changes) {
        const r = space.records[recordKey(c.collection, c.key)]!
        r.operation =
          'git-' + snapshot.headSha + ':' + recordKey(c.collection, c.key)
      }
      records = space.records
    }
  }
  return { snapshot, document, records, envelope }
}
export async function syncDocument(
  adapter: RepositoryAdapter,
  target: Target,
  kind: 'user-data' | 'event-feed',
  space: Space,
  allowMissing = false,
): Promise<Records> {
  let conflict: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await readDocument(adapter, target, kind, allowMissing)
    const local = Object.fromEntries(
      Object.entries(space.records).filter(([, r]) =>
        kind === 'user-data'
          ? profileCollections.has(r.collection)
          : ['events', 'feed'].includes(r.collection),
      ),
    )
    const merged = mergeRecords(remote.records, local)
    if (kind === 'event-feed') {
      // Generated metadata belongs to the shared feed, not the device's local
      // profile id. Persist it so a collaborator cannot rename the feed on sync.
      const seed = remote.document ?? eventFeed(space, merged)
      for (const change of documentChanges(seed).filter((c) => c.collection === 'feed')) {
        const key = recordKey(change.collection, change.key)
        merged[key] ??= {
          ...change,
          deleted: false,
          operation: 'feed-metadata:' + key,
          revision: { time: 0, counter: 0, device: '' },
          history: [],
        }
      }
    }
    const document =
      kind === 'user-data'
        ? materializeProfile(merged)
        : eventFeed(space, merged)
    if (!createValidator().validate(kind, document).ok)
      throw new Error('messages.invalid_merged_content_nothing_was_written')
    const envelope: RemoteEnvelope = {
      version: 1,
      records: merged,
      projection: document,
    }
    if (equal(remote.envelope, envelope) && equal(remote.document, document))
      return merged
    try {
      await adapter.commitFiles({
        locator: locatorFor(target),
        branch: remote.snapshot.defaultBranch,
        expectedHeadSha: remote.snapshot.headSha,
        message: 'Sync Ahead ' + (kind === 'user-data' ? 'profile' : 'events'),
        files: [
          { path: target.path, content: stringifyYaml(document) },
          {
            path: metadataPath(target.path),
            content: JSON.stringify(envelope),
          },
        ],
      })
      return merged
    } catch (error) {
      if (
        ![409, 422].includes(httpStatus(error) ?? 0) &&
        !String(error).includes('head changed')
      )
        throw error
      conflict = error
    }
  }
  throw conflict ?? new Error('messages.version_conflict_please_retry_later')
}
