import { create } from 'zustand'
import {
  LocalDatabase,
  applyChanges,
  newSpace,
  type Database,
  type Records,
  type Space,
} from '@ahead/sync'
import { createIdbStore } from '../lib/idb'
import {
  emptyProfile,
  changeProfile,
  type ProfileAction,
} from '../lib/local-profile'
import {
  profileChanges,
  diffRecords,
  materializeProfile,
  profileCollections,
  validEvent,
  personalEvents,
} from './model'
import type { Event, UserData } from '@ahead/schema'
const storage = createIdbStore('ahead-workspaces', 'state')
export const database = new LocalDatabase({
  read: () => storage.get<Database>('root'),
  update: (fn) => storage.update('root', fn),
})
for (const name of [...profileCollections, 'feed'])
  database.register(name, () => true)
database.register('events', validEvent)
database.validateWith((records) => {
  materializeProfile(records)
  personalEvents(records)
})
export const useData = create<{
  db?: Database
  ready: boolean
  error?: string
}>(() => ({ ready: false }))
const broadcast =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('ahead-data')
database.subscribe((db) =>
  useData.setState({ db, ready: true, error: undefined }),
)
broadcast?.addEventListener('message', () => {
  void database.reload().catch(() => {})
})
export function changed() {
  broadcast?.postMessage('changed')
}
let initialization: Promise<void> | undefined
export function initializeData() {
  initialization ??= (async () => {
    const old = await createIdbStore(
      'ahead-local-profile',
      'data',
    ).get<UserData>('profile')
    await database.transaction((db) => {
      if (db.migrated) return
      db.migrationBackup = old
      const profile = old ?? emptyProfile()
      applyChanges(db, db.spaces.guest!, profileChanges(profile))
      db.migrated = true
    })
  })().catch((error) => {
    useData.setState({ error: '无法打开本机资料，请检查浏览器存储权限' })
    initialization = undefined
    throw error
  })
  return initialization
}
export function activeSpace(): Space | undefined {
  const db = useData.getState().db
  return db?.spaces[db.active]
}
export async function mutateProfile(id: string, action: ProfileAction) {
  let previous: UserData | undefined
  await database.mutate(id, (records) => {
    previous = materializeProfile(records)
    return diffRecords(
      records,
      profileChanges(changeProfile(previous, action)),
      profileCollections,
    )
  })
  changed()
  return previous!
}
export async function replaceLocalProfile(id: string, profile: UserData) {
  await database.mutate(id, (records) =>
    diffRecords(records, profileChanges(profile), profileCollections),
  )
  changed()
}
export async function saveEvent(id: string, event: Event, originalId?: string) {
  if (originalId && event.id !== originalId)
    throw new Error('编辑事件时不能更改事件 ID')
  await database.mutate(id, (records) => {
    if (
      !originalId &&
      Object.values(records).some(
        (r) => r.collection === 'events' && r.key === event.id,
      )
    )
      throw new Error('事件 ID 已存在')
    return [{ collection: 'events', key: event.id, value: event }]
  })
  changed()
}
export async function deleteEvent(id: string, eventId: string) {
  await database.mutate(id, [
    { collection: 'events', key: eventId, deleted: true },
  ])
  changed()
}
export async function createLocalProfile(
  name: string,
  privateRepo: boolean,
  account?: string,
  bio?: string,
) {
  const id = crypto.randomUUID()
  await database.transaction((db) => {
    const space = newSpace(id, name, privateRepo)
    space.account = account
    if (account)
      space.provision = { repo: 'ahead-user-' + id.slice(0, 8), marker: id }
    db.spaces[id] = space
    applyChanges(
      db,
      space,
      profileChanges({
        ...emptyProfile(),
        id: 'user-' + id,
        displayName: { 'zh-CN': name },
        ...(bio?.trim() ? { bio: { 'zh-CN': bio.trim() } } : {}),
      }),
    )
  })
  changed()
  return id
}
export async function selectProfile(
  id: string,
  account?: string,
  importGuest = false,
) {
  await database.transaction((db) => {
    const space = db.spaces[id]
    if (!space || (space.account && space.account !== account))
      throw new Error('无法使用此个人资料')
    if (account && !space.account) {
      space.account = account
      space.provision ??= { repo: 'ahead-user-' + id.slice(0, 8), marker: id }
    }
    if (importGuest && id !== 'guest') {
      const guest = db.spaces.guest!
      const data = Object.values(guest.records).filter(
        (r) =>
          !r.deleted && r.collection !== 'profile' && r.collection !== 'feed',
      )
      if (data.length) {
        db.guestBackups = [
          ...(db.guestBackups ?? []),
          structuredClone(guest.records),
        ]
        applyChanges(
          db,
          space,
          data.map((r) => ({
            collection: r.collection,
            key: r.key,
            value: r.value,
          })),
        )
        db.spaces.guest = newSpace('guest', '本机资料')
        applyChanges(db, db.spaces.guest, profileChanges(emptyProfile()))
      }
    }
    db.active = id
    if (account) db.selected[account] = id
  })
  changed()
}
export function profileFromSpace(space?: Space) {
  return space ? materializeProfile(space.records) : emptyProfile()
}
export function activeRecords(): Records {
  return activeSpace()?.records ?? {}
}
