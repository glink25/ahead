import { createLocalProfile as create, database, useData } from '../data/local'
import { personalEvents } from '../data/model'
import { defaultSyncProvider } from '../adapters/sync'
import { syncNow } from '../data/scheduler'
import { workspaceRecords as materializedRecords } from '@ahead/sync'
export { useData as useWorkspace, saveEvent, deleteEvent, mutateProfile, replaceLocalProfile } from '../data/local'
export { PERSONAL_FEED } from '../data/model'
export { connectProfile, discoverProfiles } from '../data/profiles'
export { chooseProfile, activateSession } from '../data/session'
export { syncNow, setPaused } from '../data/scheduler'
export function createLocalProfile(name: string, privateResource: boolean, account?: string, bio?: string, language?: string) {
  return create(name, privateResource, account, bio, language, account ? defaultSyncProvider : undefined)
}
export function workspaceEvents(spaceId: string) {
  const space = useData.getState().db?.spaces[spaceId]
  return space ? personalEvents(materializedRecords(space)) : []
}
export async function renamePendingTarget(spaceId: string, name: string) {
  await database.transaction((db) => {
    const space = db.spaces[spaceId]
    if (!space) throw new Error('Profile not found')
    const target = space.remote ? space.feedProvision : space.provision
    if (target) target.name = name.trim()
  })
  await syncNow(spaceId)
}
