import { applyChanges, replaceCollections, workspaceRecords, type Patch, type Records, type Space, type Target } from '@ahead/sync'
import type { AuthSession, RepositoryAdapter } from '@ahead/core'
import { authenticatedAdapter } from '../lib/auth'
import { database } from '../data/local'
import { materializeProfile, PERSONAL_FEED, profileCollections } from '../data/model'
import { sourceKey, manifestPath } from '@ahead/protocol'
import { checkedTarget, feedCollections, httpStatus, locatorFor, readDocument, syncDocument } from './github-document'
import { connectProfile, discoverProfiles } from './github-profiles'

async function updateSpace(id: string, update: (space: Space) => void) {
  await database.transaction((db) => { const space = db.spaces[id]; if (space) update(space) })
}

async function ensureRepository(adapter: RepositoryAdapter, space: Space, kind: 'remote' | 'feed', owner: string, collision = 0): Promise<Target> {
  if (space[kind]) return space[kind]!
  const field = kind === 'remote' ? 'provision' : 'feedProvision'
  let provision = space[field]
  if (!provision) {
    provision = { name: 'ahead-feed-personal-' + space.id.slice(0, 8) }
    await updateSpace(space.id, (current) => { current[field] = provision })
  }
  const target: Target = { locator: `github:${owner}/${provision.name}`, path: 'ahead.yaml', private: space.private }
  try {
    await adapter.inspect(locatorFor(target))
    if (collision >= 3) throw new Error('messages.a_repository_with_this_name_already_exists_choose_another_name')
    const next = { name: provision.name + '-' + crypto.randomUUID().slice(0, 4) }
    await updateSpace(space.id, (current) => { current[field] = next })
    return ensureRepository(adapter, { ...space, [field]: next }, kind, owner, collision + 1)
  } catch (error) {
    if (httpStatus(error) !== 404) throw error
    await adapter.createRepository({ name: provision.name, description: kind === 'remote' ? 'Ahead profile' : 'Ahead personal events', private: target.private, autoInit: true })
    const created = await adapter.inspect(locatorFor(target))
    checkedTarget(created, target)
    target.metadata = { repositoryId: created.repositoryId }
  }
  await updateSpace(space.id, (current) => { current[kind] = target })
  return target
}

function patchesFor(space: Space, collections: ReadonlySet<string>) {
  return Object.fromEntries(Object.entries(space.patches).filter(([, patch]) => collections.has(patch.collection)))
}

function acceptResult(space: Space, target: 'remote' | 'feed', records: Records, version: string, sent: Record<string, Patch>) {
  const collections = target === 'remote' ? profileCollections : feedCollections
  space.baseRecords = replaceCollections(space.baseRecords, records, collections)
  for (const [key, patch] of Object.entries(sent))
    if (space.patches[key]?.operation === patch.operation) delete space.patches[key]
  space[target]!.version = version
}

async function synchronize(id: string, auth: AuthSession, valid: () => void) {
  const adapter = authenticatedAdapter(auth, valid)
  const guarded: RepositoryAdapter = {
    inspect: async (...args) => { valid(); return adapter.inspect(...args) },
    readFile: async (...args) => { valid(); return adapter.readFile(...args) },
    readTree: async (...args) => { valid(); return adapter.readTree(...args) },
    commitFiles: async (...args) => { valid(); return adapter.commitFiles(...args) },
    createRepository: async (...args) => { valid(); return adapter.createRepository(...args) },
  }
  let current = (await database.query()).spaces[id]
  if (!current || current.account !== String(auth.identity.id) || current.paused) return
  await updateSpace(id, (space) => { space.status = 'syncing'; space.error = undefined })

  const profileTarget = await ensureRepository(guarded, current, 'remote', auth.identity.login)
  const profileRemote = await readDocument(guarded, profileTarget, 'user-data', Boolean(current.provision))
  await database.transaction((db) => {
    valid()
    const space = db.spaces[id]!
    space.baseRecords = replaceCollections(space.baseRecords, profileRemote.records, profileCollections)
    space.remote!.version = profileRemote.document ? profileRemote.snapshot.headSha : undefined
  })

  current = (await database.query()).spaces[id]!
  const link = materializeProfile(workspaceRecords(current)).extensions?.[PERSONAL_FEED] as { locator?: string; manifestPath?: string } | undefined
  if (current.feed && link?.locator && (link.locator !== current.feed.locator || manifestPath(link.manifestPath) !== current.feed.path))
    throw new Error('messages.the_personal_event_sync_destination_changed_check_the_profile_link_and_retr')
  if (link?.locator && !current.feed) {
    if (!/^github:([^/]+)\/([^/]+)$/.test(link.locator)) throw new Error('messages.invalid_personal_feed_link')
    await updateSpace(id, (space) => { space.feed = { locator: link.locator!, path: manifestPath(link.manifestPath), private: space.private } })
    current = (await database.query()).spaces[id]!
  }

  if (current.feed || Object.values(workspaceRecords(current)).some((record) => record.collection === 'events')) {
    const feed = await ensureRepository(guarded, current, 'feed', auth.identity.login)
    current = (await database.query()).spaces[id]!
    const sent = patchesFor(current, feedCollections)
    const result = await syncDocument(guarded, feed, 'event-feed', structuredClone(current), sent, Boolean(current.feedProvision))
    valid()
    await database.transaction((db) => {
      valid()
      const space = db.spaces[id]!
      acceptResult(space, 'feed', result.records, result.version, sent)
      delete space.feedProvision
      const source = { locator: feed.locator, manifestPath: feed.path, kind: 'event-feed' as const }
      applyChanges(db, space, [
        { collection: 'extensions', key: PERSONAL_FEED, value: source },
        { collection: 'subscriptions', key: sourceKey(source), value: source },
      ])
    })
  }

  current = (await database.query()).spaces[id]!
  const sent = patchesFor(current, profileCollections)
  const result = await syncDocument(guarded, profileTarget, 'user-data', structuredClone(current), sent, Boolean(current.provision))
  valid()
  await database.transaction((db) => {
    valid()
    const space = db.spaces[id]!
    acceptResult(space, 'remote', result.records, result.version, sent)
    delete space.provision
    space.name = Object.values(materializeProfile(workspaceRecords(space)).displayName)[0] ?? space.name
    space.status = Object.keys(space.patches).length ? 'pending' : 'synced'
    space.lastSynced = new Date().toISOString()
    space.attempts = 0
    space.retryAt = undefined
  })
}

function classifySyncError(error: unknown) {
  const status = httpStatus(error)
  const headers = (error as { response?: { headers?: Record<string, string> } }).response?.headers
  const throttled = status === 403 && (headers?.['x-ratelimit-remaining'] === '0' || Boolean(headers?.['retry-after']))
  const retryable = Boolean(throttled || error instanceof TypeError || status === 429 || (status && status >= 500) || [409, 422].includes(status ?? 0) || String(error).includes('head changed'))
  return {
    retryable,
    authentication: status === 401,
    message: status === 401 ? 'messages.sign_in_required' : status === 403 ? 'messages.check_repository_permissions_or_retry_later' : String(error),
    retryAfter: (Number(headers?.['retry-after']) || Math.max(0, Number(headers?.['x-ratelimit-reset']) * 1000 - Date.now()) / 1000 || 0) * 1000,
  }
}

export const githubSyncAdapter = { id: 'github', synchronize, connect: connectProfile, discover: discoverProfiles, classify: classifySyncError }
