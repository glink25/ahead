import { it, expect, vi } from 'vitest'
import { mergeProfile, syncProfile } from './sync'
import { emptyProfile } from './local-profile'
import type { RepositoryAdapter } from '@ahead/core'
it('three-way merge preserves remote additions and local removals', () => {
  const base = { ...emptyProfile(), favorites: ['remove', 'keep'], subscriptions: [{ locator: 'github:a/b', manifestPath: 'feeds/a.yaml' }] }
  const remote = { ...base, id: 'remote', favorites: ['remove', 'keep', 'remote-new'] }
  const local = { ...base, favorites: ['keep', 'local-new'], subscriptions: [{ locator: 'github:a/b', manifestPath: 'feeds/b.yaml' }] }
  const merged = mergeProfile(remote, local, base)
  expect(merged.id).toBe('remote')
  expect(merged.favorites).toEqual(['keep', 'remote-new', 'local-new'])
  expect(merged.subscriptions).toEqual(local.subscriptions)
})
it('writes with the inspected head and surfaces conflicts without a force overwrite', async () => {
  const commitFiles = vi.fn().mockRejectedValue(new Error('Repository head changed'))
  const adapter = {
    inspect: vi.fn().mockResolvedValue({ headSha: 'head', defaultBranch: 'main' }),
    readFile: vi.fn().mockResolvedValue({ content: JSON.stringify(emptyProfile()) }),
    commitFiles,
  } as unknown as RepositoryAdapter
  await expect(syncProfile({ adapter, locator: 'github:a/b', local: emptyProfile() })).rejects.toThrow('head changed')
  expect(commitFiles.mock.calls[0]?.[0]).toMatchObject({ expectedHeadSha: 'head', branch: 'main' })
  expect(commitFiles).toHaveBeenCalledTimes(1)
})
