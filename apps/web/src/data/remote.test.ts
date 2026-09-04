import { it, expect } from 'vitest'
import type { RepositoryAdapter, CommitFilesInput } from '@ahead/core'
import { newDatabase, applyChanges } from '@ahead/sync'
import { emptyProfile } from '../lib/local-profile'
import {
  profileChanges,
  diffRecords,
  materializeProfile,
  profileCollections,
} from './model'
import { syncDocument, readDocument } from './remote'
function remote() {
  const files = new Map([
    [
      'ahead.yaml',
      JSON.stringify({
        ...emptyProfile(),
        extensions: { thirdParty: { preserve: true } },
      }),
    ],
  ])
  let revision = 1,
    commits = 0,
    loseResponse = false,
    conflict = false,
    privateRepo = true
  const adapter = {
    inspect: async () => ({
      headSha: String(revision),
      defaultBranch: 'main',
      private: privateRepo,
      committedAt: new Date(5000 + revision).toISOString(),
    }),
    readFile: async (_: unknown, path: string) => {
      if (!files.has(path))
        throw Object.assign(new Error('not found'), { status: 404 })
      return { content: files.get(path), path }
    },
    commitFiles: async (input: CommitFilesInput) => {
      if (conflict) {
        conflict = false
        revision++
        throw Object.assign(new Error('head changed'), { status: 409 })
      }
      expect(input.expectedHeadSha).toBe(String(revision))
      for (const file of input.files) files.set(file.path, file.content)
      revision++
      commits++
      if (loseResponse) {
        loseResponse = false
        throw new TypeError('connection lost')
      }
      return { sha: String(revision) }
    },
  } as unknown as RepositoryAdapter
  return {
    files,
    adapter,
    commits: () => commits,
    lose: () => {
      loseResponse = true
    },
    conflict: () => {
      conflict = true
    },
    makePublic: () => {
      privateRepo = false
    },
  }
}
const target = {
  owner: 'a',
  repo: 'profile',
  path: 'ahead.yaml',
  private: true,
}
it('syncs standard UserData, preserves extensions, and absorbs valid external edits', async () => {
  const r = remote(),
    db = newDatabase(),
    space = db.spaces.guest!
  const initial = await readDocument(r.adapter, target, 'user-data')
  space.records = initial.records
  const profile = materializeProfile(space.records)
  profile.favorites = ['mine']
  applyChanges(
    db,
    space,
    diffRecords(space.records, profileChanges(profile), profileCollections),
    1000,
  )
  space.records = await syncDocument(r.adapter, target, 'user-data', space)
  expect(materializeProfile(space.records).extensions?.thirdParty).toEqual({
    preserve: true,
  })
  const external = materializeProfile(space.records)
  external.favorites!.push('external')
  r.files.set('ahead.yaml', JSON.stringify(external))
  space.records = await syncDocument(r.adapter, target, 'user-data', space)
  expect(materializeProfile(space.records).favorites).toEqual(
    expect.arrayContaining(['mine', 'external']),
  )
})
it('recognizes a lost commit response without duplicating the commit, and retries HEAD conflicts', async () => {
  const r = remote(),
    db = newDatabase(),
    space = db.spaces.guest!
  applyChanges(db, space, profileChanges(emptyProfile()), 1000)
  r.lose()
  await expect(
    syncDocument(r.adapter, target, 'user-data', space),
  ).rejects.toThrow('connection lost')
  await syncDocument(r.adapter, target, 'user-data', space)
  expect(r.commits()).toBe(1)
  applyChanges(
    db,
    space,
    [{ collection: 'favorites', key: 'new', value: true }],
    2000,
  )
  r.conflict()
  await syncDocument(r.adapter, target, 'user-data', space)
  expect(r.commits()).toBe(2)
})
it('refuses visibility changes and malformed content without writing', async () => {
  const r = remote(),
    space = newDatabase().spaces.guest!
  r.makePublic()
  await expect(
    syncDocument(r.adapter, target, 'user-data', space),
  ).rejects.toThrow('可见性')
  expect(r.commits()).toBe(0)
  const broken = remote()
  broken.files.set('ahead.yaml', 'invalid: true')
  await expect(
    syncDocument(broken.adapter, target, 'user-data', space),
  ).rejects.toThrow('格式')
  expect(broken.commits()).toBe(0)
})
