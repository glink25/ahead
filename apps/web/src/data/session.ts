import type { AuthSession } from '@ahead/core'
import { authStore } from './storage'
import { database, initializeData, selectProfile } from './local'
import { setSyncSession, startScheduler } from './scheduler'
import { useAuthSession } from '../stores'
export async function restoreCachedIdentity() {
  return (await authStore.get<AuthSession>('last-session')) ?? null
}
export async function activateSession(
  session: AuthSession | null,
  explicit = false,
  verified = true,
) {
  await initializeData()
  startScheduler()
  if (!session) {
    setSyncSession(null)
    const db = await database.query()
    if (db.spaces[db.active]?.account) await selectProfile('guest')
    return
  }
  await authStore.set('last-session', session)
  const account = String(session.identity.id),
    db = await database.query()
  if (!explicit && db.selected[account] && db.spaces[db.selected[account]!])
    await selectProfile(db.selected[account]!, account)
  else await selectProfile('guest')
  // Without a selection, do not bootstrap/sync newly discovered profiles.
  setSyncSession(verified && !explicit && db.selected[account] ? session : null)
}
export async function chooseProfile(id: string, session: AuthSession | null) {
  await selectProfile(
    id,
    session ? String(session.identity.id) : undefined,
    Boolean(session),
  )
  setSyncSession(useAuthSession.getState().verified ? session : null)
}
