import { parseLocator, manifestPath, sourceKey } from '@ahead/protocol'
import { applyChanges, newSpace, mergeRecords, type Target } from '@ahead/sync'
import type { AuthSession } from '@ahead/core'
import { authenticatedAdapter } from '../lib/auth'
import { database, changed } from './local'
import { readDocument } from './remote'
import { materializeProfile } from './model'
export async function connectProfile(
  auth: AuthSession,
  address: string,
  path = 'ahead.yaml',
) {
  const locator = parseLocator(address)
  if (!('owner' in locator)) throw new Error('请输入 GitHub 仓库地址')
  const adapter = authenticatedAdapter(auth),
    snapshot = await adapter.inspect(locator)
  if (snapshot.writable === false) throw new Error('此仓库没有写入权限')
  const target: Target = {
    owner: locator.owner,
    repo: locator.repo,
    path: manifestPath(path),
    private: snapshot.private,
    repositoryId: snapshot.repositoryId,
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
    const existing = Object.values(db.spaces).find(
      (s) =>
        s.account === account &&
        s.remote &&
        sourceKey({
          locator: 'github:' + s.remote.owner + '/' + s.remote.repo,
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
    space.private = target.private
    space.records = mergeRecords(space.records, remote.records)
    space.status = 'pending'
    space.error = undefined
    space.retryAt = undefined
    db.spaces[space.id] = space
  })
  changed()
  const db = await database.query()
  return Object.values(db.spaces).find(
    (s) =>
      s.account === account &&
      s.remote?.repositoryId === target.repositoryId &&
      s.remote?.owner === target.owner &&
      s.remote?.repo === target.repo &&
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
          onProgress('正在查找个人资料…')
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
