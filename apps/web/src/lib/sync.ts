import type { RepositoryAdapter } from '@ahead/core'
import { parseLocator, parseYaml, stringifyYaml, sourceKey, manifestPath } from '@ahead/protocol'
import { createValidator, type UserData } from '@ahead/schema'

/** Apply local changes since the last sync onto fresh remote data. */
export function mergeProfile(remote: UserData, local: UserData, base?: UserData): UserData {
  const merged = structuredClone(remote)
  for (const key of ['favorites', 'hidden', 'pins'] as const) {
    const values = new Set(remote[key] ?? [])
    for (const id of base?.[key] ?? []) if (!local[key]?.includes(id)) values.delete(id)
    for (const id of local[key] ?? []) if (!base?.[key]?.includes(id)) values.add(id)
    merged[key] = [...values]
  }
  const subscriptions = new Map((remote.subscriptions ?? []).map((s) => [sourceKey(s), s]))
  const before = new Map((base?.subscriptions ?? []).map((s) => [sourceKey(s), s]))
  const after = new Map((local.subscriptions ?? []).map((s) => [sourceKey(s), s]))
  for (const key of before.keys()) if (!after.has(key)) subscriptions.delete(key)
  for (const [key, value] of after) if (JSON.stringify(value) !== JSON.stringify(before.get(key))) subscriptions.set(key, value)
  merged.subscriptions = [...subscriptions.values()]
  for (const key of ['interests', 'settings', 'notes'] as const) {
    const values: Record<string, unknown> = { ...remote[key] }
    for (const name of Object.keys(base?.[key] ?? {})) if (!(name in (local[key] ?? {}))) delete values[name]
    for (const [name, value] of Object.entries(local[key] ?? {})) {
      if (JSON.stringify(value) !== JSON.stringify(base?.[key]?.[name])) values[name] = value
    }
    Object.assign(merged, { [key]: values })
  }
  return merged
}

export async function syncProfile(options: {
  adapter: RepositoryAdapter; locator: string; path?: string; local: UserData; base?: UserData
}): Promise<UserData> {
  const locator = parseLocator(options.locator)
  if (!('owner' in locator)) throw new Error('仅支持 GitHub 用户数据仓库')
  const path = manifestPath(options.path)
  const snapshot = await options.adapter.inspect(locator)
  const file = await options.adapter.readFile(locator, path, { ref: snapshot.headSha })
  const remote = parseYaml<UserData>(file.content)
  const validator = createValidator()
  if (!validator.validate('user-data', remote).ok) throw new Error('远端不是有效的 UserData，未写入')
  const merged = mergeProfile(remote, options.local, options.base)
  if (!validator.validate('user-data', merged).ok) throw new Error('合并后超出协议限制，未写入')
  await options.adapter.commitFiles({
    locator, branch: snapshot.defaultBranch, expectedHeadSha: snapshot.headSha,
    message: 'Update Ahead profile',
    files: [{ path, content: stringifyYaml(merged) }],
  })
  return merged
}
