import type { AuthSession } from '@ahead/core'
import { createIdbStore } from '../lib/idb'
import { database, initializeData, selectProfile } from './local'
import { setSyncSession, startScheduler } from './scheduler'
const identities = createIdbStore('ahead-account-cache', 'sessions')
export async function restoreCachedIdentity() {
  return (await identities.get<AuthSession>('last')) ?? null
}
export async function activateSession(
  session: AuthSession | null,
  explicit = false,
) {
  await initializeData()
  startScheduler()
  if (!session) {
    setSyncSession(null)
    const db = await database.query()
    if (db.spaces[db.active]?.account) await selectProfile('guest')
    return
  }
  await identities.set('last', session)
  const account = String(session.identity.id),
    db = await database.query()
  if (!explicit && db.selected[account] && db.spaces[db.selected[account]!])
    await selectProfile(db.selected[account]!, account)
  else await selectProfile('guest')
  // Without a selection, do not bootstrap/sync newly discovered profiles.
  setSyncSession(explicit || !db.selected[account] ? null : session)
}
export async function chooseProfile(id: string, session: AuthSession | null) {
  await selectProfile(
    id,
    session ? String(session.identity.id) : undefined,
    Boolean(session),
  )
  setSyncSession(session)
}
export async function forgetSession() {
  setSyncSession(null)
  await identities.delete('last')
  await selectProfile('guest')
}
