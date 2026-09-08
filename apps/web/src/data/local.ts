import { LocalWorkspaceAdapter } from '../adapters/local-workspace'
import { create } from 'zustand'
import {
  applyChanges,
  newSpace,
  workspaceRecords,
  type Database,
  type Records,
  type Space,
} from '@ahead/sync'
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
} from './model'
import type { Event, UserData } from '@ahead/schema'
export const database = new LocalWorkspaceAdapter()
export const useData = create<{
  db?: Database
  ready: boolean
  error?: string
}>(() => ({ ready: false }))
database.subscribe((db) => {
  useData.setState({ db, ready: true, error: undefined })
})
database.onReadError = () => useData.setState({ error: 'messages.cannot_open_local_profiles_check_browser_storage_permissions' })
let initialization: Promise<void> | undefined
export function initializeData() {
  initialization ??= database.reload().then(() => undefined).catch((error) => {
    useData.setState({ error: 'messages.cannot_open_local_profiles_check_browser_storage_permissions' })
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
    const next = changeProfile(previous, action)
    const changes = diffRecords(
      records,
      profileChanges(next),
      profileCollections,
    )
    if (changes.some((change) => change.collection === 'profile' && change.key === 'displayName'))
      changes.push({ collection: 'feed', key: 'name', value: next.displayName })
    return changes
  })
  return previous!
}
export async function replaceLocalProfile(id: string, profile: UserData) {
  await database.mutate(id, (records) => {
    const changes = diffRecords(records, profileChanges(profile), profileCollections)
    if (changes.some((change) => change.collection === 'profile' && change.key === 'displayName'))
      changes.push({ collection: 'feed', key: 'name', value: profile.displayName })
    return changes
  })
}
export async function saveEvent(id: string, event: Event, originalId?: string) {
  if (originalId && event.id !== originalId)
    throw new Error('messages.the_event_id_cannot_be_changed_while_editing')
  await database.mutate(id, (records) => {
    if (
      !originalId &&
      Object.values(records).some(
        (r) => r.collection === 'events' && r.key === event.id,
      )
    )
      throw new Error('messages.this_event_id_already_exists')
    return [{ collection: 'events', key: event.id, value: event }]
  })
}
export async function deleteEvent(id: string, eventId: string) {
  await database.mutate(id, [
    { collection: 'events', key: eventId, deleted: true },
  ])
}
export async function createLocalProfile(
  name: string,
  privateRepo: boolean,
  account?: string,
  bio?: string,
  language = 'zh-CN',
  syncProvider?: string,
) {
  const id = crypto.randomUUID()
  await database.transaction((db) => {
    const space = newSpace(id, name, privateRepo)
    space.account = account
    if (account) space.syncProvider = syncProvider
    if (account)
      space.provision = { name: 'ahead-user-' + id.slice(0, 8) }
    db.spaces[id] = space
    applyChanges(
      db,
      space,
      profileChanges({
        ...emptyProfile(),
        id: 'user-' + id,
        displayName: { [language]: name },
        ...(bio?.trim() ? { bio: { [language]: bio.trim() } } : {}),
      }),
    )
  })
  return id
}
export async function selectProfile(
  id: string,
  account?: string,
  importGuest = false,
  syncProvider?: string,
) {
  await database.transaction((db) => {
    const space = db.spaces[id]
    if (!space || (space.account && space.account !== account))
      throw new Error('messages.cannot_use_this_profile')
    if (account && !space.account && id !== 'guest') {
      space.account = account
      space.syncProvider = syncProvider
      space.provision ??= { name: 'ahead-user-' + id.slice(0, 8) }
    }
    if (importGuest && id !== 'guest') {
      const guest = db.spaces.guest!
      const guestRecords = workspaceRecords(guest)
      const data = Object.values(guestRecords).filter(
        (r) =>
          r.collection !== 'profile' && r.collection !== 'feed',
      )
      if (data.length) {
        db.guestBackups = [
          ...(db.guestBackups ?? []),
          structuredClone(guestRecords),
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
        db.spaces.guest = newSpace('guest', 'Local profile')
        applyChanges(db, db.spaces.guest, profileChanges(emptyProfile()))
      }
    }
    db.active = id
    if (account) db.selected[account] = id
  })
}
export function profileFromSpace(space?: Space) {
  return space ? materializeProfile(workspaceRecords(space)) : emptyProfile()
}
export function activeRecords(): Records {
  const space = activeSpace()
  return space ? workspaceRecords(space) : {}
}
