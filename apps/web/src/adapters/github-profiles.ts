import { useAuthSession } from '../stores'
import { parseLocator, manifestPath, sourceKey } from '@ahead/protocol'
import { newSpace, replaceCollections, type Target } from '@ahead/sync'
import type { AuthSession } from '@ahead/core'
import { authenticatedAdapter } from '../lib/auth'
import { database } from '../data/local'
import { readDocument } from '../adapters/github-document'
import { materializeProfile, profileCollections } from '../data/model'
export async function connectProfile(
  auth: AuthSession,
  address: string,
  path = 'ahead.yaml',
) {
  const locator = parseLocator(address)
  if (!('owner' in locator)) throw new Error('messages.enter_a_github_repository_address')
  const valid = () => {
    const active = useAuthSession.getState().session
    if (active?.identity.id !== auth.identity.id || active.providerId !== auth.providerId) throw new Error('messages.signed_in_identity_changed_please_refresh')
  }
  const adapter = authenticatedAdapter(auth, valid),
    snapshot = await adapter.inspect(locator)
  if (snapshot.writable === false) throw new Error('messages.you_do_not_have_write_access_to_this_repository')
  const target: Target = {
    locator: address,
    path: manifestPath(path),
    private: snapshot.private,
    metadata: { repositoryId: snapshot.repositoryId },
    version: snapshot.headSha,
  }
  const remote = await readDocument(adapter, target, 'user-data')
  const account = String(auth.identity.id)
  // Repository identity and manifest path are the binding; UserData.id is not unique.
  const id =
    account +
    ':' +
    (snapshot.repositoryId ?? locator.owner + '/' + locator.repo) +
    ':' +
    target.path
  await database.transaction((db) => {
    valid()
    const existing = Object.values(db.spaces).find(
      (s) =>
        s.account === account &&
        s.remote &&
        sourceKey({
          locator: s.remote.locator,
          manifestPath: s.remote.path,
        }) === sourceKey({ locator: address, manifestPath: target.path }),
    )
    const space =
      existing ??
      newSpace(
        id,
        Object.values(materializeProfile(remote.records).displayName)[0] ??
          locator.repo,
        target.private,
      )
    space.remote = target
    space.account = account
    space.syncProvider = 'github'
    space.private = target.private
    space.baseRecords = replaceCollections(space.baseRecords, remote.records, profileCollections)
    space.status = Object.keys(space.patches).length ? 'pending' : 'synced'
    space.error = undefined
    space.retryAt = undefined
    db.spaces[space.id] = space
  })
  const db = await database.query()
  return Object.values(db.spaces).find(
    (s) =>
      s.account === account &&
      s.remote?.locator === target.locator &&
      s.remote?.path === target.path,
  )!.id
}
export async function discoverProfiles(
  auth: AuthSession,
  onProgress: (message: string) => void,
  signal: AbortSignal,
) {
  const adapter = authenticatedAdapter(auth)
  for (let page = 1; !signal.aborted; page++) {
    const repositories = await adapter.listRepositories(page)
    if (!repositories.length) return
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(4, repositories.length) }, async () => {
        while (cursor < repositories.length && !signal.aborted) {
          const repo = repositories[cursor++]!
          if (repo.writable === false) continue
          onProgress('messages.finding_profiles')
          try {
            await connectProfile(auth, 'github:' + repo.owner + '/' + repo.repo)
          } catch {
            /* A repository need not contain a UserData manifest. */
          }
        }
      }),
    )
    // Continue until the API returns an empty page.
  }
}
