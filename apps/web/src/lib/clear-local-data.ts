import { setSyncSession } from '../data/scheduler'
import { suspendStorage } from '../data/storage'
import { resetChannel, resetLock, resetMarker } from './reset-listener'

const waitForPeers = () => new Promise((resolve) => window.setTimeout(resolve, 250))

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    const timer = window.setTimeout(
      () => reject(new Error('IndexedDB deletion was blocked')),
      8_000,
    )
    request.onsuccess = () => {
      window.clearTimeout(timer)
      resolve()
    }
    request.onerror = () => {
      window.clearTimeout(timer)
      reject(request.error ?? new Error('IndexedDB deletion failed'))
    }
  })
}

async function performClear(channel?: BroadcastChannel): Promise<void> {
  let started = false
  try {
    localStorage.setItem(resetMarker, String(Date.now()))
    started = true
    window.dispatchEvent(new Event('ahead-reset'))
    channel?.postMessage('prepare')
    setSyncSession(null)
    await suspendStorage()
    await waitForPeers()

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }

    if (!indexedDB.databases)
      throw new Error('This browser cannot enumerate IndexedDB databases')
    const databases = await indexedDB.databases()
    await Promise.all(
      databases.flatMap((database) => database.name ? [deleteDatabase(database.name)] : []),
    )

    if (navigator.storage?.getDirectory) {
      const directory = await navigator.storage.getDirectory()
      const names = (directory as FileSystemDirectoryHandle & {
        keys(): AsyncIterable<string>
      }).keys()
      for await (const name of names)
        await directory.removeEntry(name, { recursive: true })
    }

    if ('caches' in window)
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)))

    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
    }
    sessionStorage.clear()
    localStorage.clear()
    channel?.postMessage('complete')
    window.location.replace('/discover')
  } catch (error) {
    if (started) {
      localStorage.removeItem(resetMarker)
      channel?.postMessage('abort')
    }
    throw error
  }
}

/** Clear all script-accessible data for this origin, then open a fresh app page. */
export async function clearLocalData(): Promise<void> {
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel(resetChannel)
  try {
    if (navigator.locks)
      await navigator.locks.request(resetLock, () => performClear(channel))
    else await performClear(channel)
  } finally {
    channel?.close()
  }
}
