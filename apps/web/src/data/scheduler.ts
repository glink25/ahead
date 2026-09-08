import type { AuthSession } from '@ahead/core'
import type { Space } from '@ahead/sync'
import { database, useData } from './local'
import { syncAdapter } from '../adapters/sync'
let session: AuthSession | null = null
let epoch = 0
let debounce: ReturnType<typeof setTimeout> | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
let started = false
let running = false
let syncRequested = false
let lastPending = ''
export function setSyncSession(next: AuthSession | null) {
  session = next
  epoch++
  requestSync(true)
}
const accountId = (s: AuthSession) => String(s.identity.id)
async function updateSpace(id: string, update: (space: Space) => void) {
  await database.transaction((db) => {
    const space = db.spaces[id]
    if (space) update(space)
  })
}
async function synchronize(id: string, auth: AuthSession, generation: number) {
  const valid = () => {
    if (generation !== epoch) throw new Error('SYNC_SESSION_CHANGED')
  }
  const space = (await database.query()).spaces[id]
  if (!space?.syncProvider) return
  try {
    await syncAdapter(space.syncProvider).synchronize(id, auth, valid)
  } catch (error) {
    if (generation !== epoch) return
    const failure = syncAdapter(space.syncProvider).classify(error)
    await updateSpace(id, (s) => {
      s.attempts = (s.attempts ?? 0) + 1
      const retryable = !navigator.onLine || failure.retryable
      s.status = !navigator.onLine ? 'offline' : failure.authentication ? 'auth' : retryable ? 'pending' : 'attention'
      s.error = failure.message
      s.retryAt = Date.now() + Math.max(failure.retryAfter, Math.min(300000, 2000 * 2 ** Math.min(s.attempts, 7)) * (1 + Math.random() * 0.2))
      if (retryable) setTimeout(() => requestSync(), Math.max(1000, s.retryAt - Date.now()))
    })
  }
}
export function requestSync(immediate = false) {
  if (debounce) clearTimeout(debounce)
  if (immediate) {
    if (deadline) clearTimeout(deadline)
    deadline = undefined
    void run().catch(() => useData.setState({ error: 'messages.could_not_save_check_browser_storage_permissions_and_retry' }))
    return
  }
  debounce = setTimeout(() => {
    if (deadline) clearTimeout(deadline)
    deadline = undefined
    void run().catch(() => useData.setState({ error: 'messages.could_not_save_check_browser_storage_permissions_and_retry' }))
  }, 2000)
  deadline ??= setTimeout(() => {
    if (debounce) clearTimeout(debounce)
    deadline = undefined
    void run().catch(() => useData.setState({ error: 'messages.could_not_save_check_browser_storage_permissions_and_retry' }))
  }, 15000)
}
async function run() {
  if (running) {
    syncRequested = true
    return
  }
  if (!session || !useData.getState().ready) return
  if (!navigator.onLine) {
    await database.transaction((db) => {
      for (const s of Object.values(db.spaces))
        if (s.syncProvider && s.account === accountId(session!) && !s.paused) s.status = 'offline'
    })
    return
  }
  running = true
  const auth = session,
    generation = epoch
  try {
    const work = async () => {
      const db = await database.query()
      for (const s of Object.values(db.spaces)) {
        if (generation !== epoch) break
        if (
          !s.syncProvider ||
          s.account !== accountId(auth) ||
          s.paused ||
          ['attention', 'auth'].includes(s.status) ||
          (s.retryAt ?? 0) > Date.now()
        )
          continue
        if (
          s.id === db.active ||
          Object.keys(s.patches).length ||
          s.provision ||
          s.feedProvision
        )
          await synchronize(s.id, auth, generation)
      }
    }
    if (navigator.locks)
      await navigator.locks.request(
        'ahead-sync-' + accountId(auth),
        { ifAvailable: true },
        async (lock) => {
          if (lock) await work()
        },
      )
    else await work()
  } finally {
    running = false
    if (syncRequested) {
      syncRequested = false
      requestSync()
    }
  }
}
export async function setPaused(id: string, paused: boolean) {
  await updateSpace(id, (s) => {
    if (!s.syncProvider) return
    s.paused = paused
    s.status = paused ? 'paused' : 'pending'
    s.retryAt = undefined
  })
  if (!paused) requestSync(true)
}
export async function syncNow(id: string) {
  await updateSpace(id, (s) => {
    if (!s.syncProvider) return
    s.status = 'pending'
    s.retryAt = undefined
    s.error = undefined
  })
  requestSync(true)
}
export function startScheduler() {
  if (started) return
  started = true
  database.subscribe((db) => {
    const fingerprint = Object.values(db.spaces)
      .map((s) => s.id + ':' + Object.values(s.patches).map((patch) => patch.operation).join(','))
      .join('|')
    if (fingerprint !== lastPending) {
      lastPending = fingerprint
      requestSync()
    }
  })
}
