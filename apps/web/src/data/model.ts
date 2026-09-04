import {
  createValidator,
  type UserData,
  type Event,
  type EventFeed,
} from '@ahead/schema'
import { assertDurationFitsRecurrence } from '@ahead/resolver'
import { sourceKey } from '@ahead/protocol'
import {
  entries,
  equal,
  recordKey,
  type Change,
  type Records,
  type Space,
} from '@ahead/sync'
import { emptyProfile } from '../lib/local-profile'
export const PERSONAL_FEED = 'io.ahead.personal-feed'
const validator = createValidator()
export function validEvent(value: unknown): value is Event {
  if (!validator.validate('event', value).ok) return false
  try {
    const e = value as Event
    assertDurationFitsRecurrence(e.duration, e.recurrence)
    return true
  } catch {
    return false
  }
}
export function profileChanges(profile: UserData): Change[] {
  if (!validator.validate('user-data', profile).ok)
    throw new Error('个人资料格式不正确')
  const result: Change[] = []
  for (const key of ['id', 'displayName', 'bio'] as const)
    if (profile[key] !== undefined)
      result.push({ collection: 'profile', key, value: profile[key] })
  for (const collection of [
    'settings',
    'extensions',
    'interests',
    'notes',
  ] as const) {
    for (const [key, value] of Object.entries(profile[collection] ?? {}))
      result.push({ collection, key, value })
  }
  for (const collection of ['favorites', 'hidden', 'pins'] as const)
    for (const key of profile[collection] ?? [])
      result.push({ collection, key, value: true })
  for (const sub of profile.subscriptions ?? [])
    result.push({
      collection: 'subscriptions',
      key: sourceKey(sub),
      value: sub,
    })
  const patches = new Map<string, NonNullable<UserData['patches']>>()
  for (const patch of profile.patches ?? [])
    patches.set(patch.eventId, [...(patches.get(patch.eventId) ?? []), patch])
  for (const [key, value] of patches)
    result.push({ collection: 'patches', key, value })
  return result
}
export function diffRecords(
  records: Records,
  values: Change[],
  collections?: Set<string>,
): Change[] {
  const after = new Map(values.map((v) => [recordKey(v.collection, v.key), v]))
  const changes = values.filter((v) => {
    const old = records[recordKey(v.collection, v.key)]
    return !old || old.deleted || !equal(old.value, v.value)
  })
  for (const [id, old] of Object.entries(records))
    if (
      !old.deleted &&
      (!collections || collections.has(old.collection)) &&
      !after.has(id)
    )
      changes.push({ collection: old.collection, key: old.key, deleted: true })
  return changes
}
export const profileCollections = new Set([
  'profile',
  'settings',
  'extensions',
  'interests',
  'notes',
  'favorites',
  'hidden',
  'pins',
  'subscriptions',
  'patches',
])
export function materializeProfile(records: Records): UserData {
  const profile = {
    ...emptyProfile(),
    ...Object.fromEntries(entries(records, 'profile')),
  } as UserData
  for (const key of ['settings', 'extensions', 'interests', 'notes'] as const)
    Object.assign(profile, { [key]: Object.fromEntries(entries(records, key)) })
  for (const key of ['favorites', 'hidden', 'pins'] as const)
    profile[key] = entries(records, key).map(([id]) => id)
  profile.subscriptions = entries(records, 'subscriptions').map(
    ([, value]) => value as NonNullable<UserData['subscriptions']>[number],
  )
  profile.patches = entries(records, 'patches').flatMap(
    ([, value]) => value as NonNullable<UserData['patches']>,
  )
  if (!validator.validate('user-data', profile).ok)
    throw new Error('合并后的个人资料格式不正确')
  return profile
}
export function personalEvents(records: Records): Event[] {
  return entries(records, 'events').map(([key, value]) => {
    if (!validEvent(value) || value.id !== key)
      throw new Error('个人事件格式不正确')
    return value
  })
}
export function eventFeed(space: Space, records = space.records): EventFeed {
  const metadata = Object.fromEntries(entries(records, 'feed'))
  return {
    oefVersion: '0.1',
    kind: 'event-feed',
    id: 'personal-' + space.id.replace(/[^a-z0-9._-]/gi, '-').slice(0, 90),
    name: { 'zh-CN': space.name },
    ...metadata,
    events: personalEvents(records),
  } as EventFeed
}
export function documentChanges(doc: UserData | EventFeed): Change[] {
  if (doc.kind === 'user-data') return profileChanges(doc)
  if (!validator.validate('event-feed', doc).ok || doc.eventsGlob)
    throw new Error('个人事件流需要使用内嵌事件格式')
  for (const e of doc.events ?? [])
    if (!validEvent(e)) throw new Error('个人事件格式不正确')
  return [
    ...Object.entries(doc)
      .filter(([key]) => key !== 'events')
      .map(([key, value]) => ({ collection: 'feed', key, value })),
    ...(doc.events ?? []).map((e) => ({
      collection: 'events',
      key: e.id,
      value: e,
    })),
  ]
}
