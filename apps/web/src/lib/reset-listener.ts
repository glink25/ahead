import { suspendStorage } from '../data/storage'

export const resetMarker = 'ahead-reset-in-progress'
export const resetChannel = 'ahead-reset'
export const resetLock = 'ahead-full-reset'
const staleResetMs = 15_000

/** Quiesce peer tabs while the initiating tab clears origin storage. */
export function installResetListener() {
  let leaving = false
  const leave = () => {
    if (leaving) return
    leaving = true
    window.dispatchEvent(new Event('ahead-reset'))
    sessionStorage.clear()
    void suspendStorage().then(
      () => window.location.replace('/discover'),
      () => window.location.replace('/discover'),
    )
  }
  const reopen = () => {
    if (leaving) return
    leaving = true
    window.location.replace('/discover')
  }
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload()
  })
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(resetChannel)
    channel.onmessage = (event) => {
      if (event.data === 'prepare') leave()
      if (event.data === 'complete' || event.data === 'abort') reopen()
    }
  }
  window.addEventListener('storage', (event) => {
    if (event.key === resetMarker && event.newValue) leave()
    if ((event.key === resetMarker && !event.newValue) || event.key === null)
      reopen()
  })
  try {
    const marker = localStorage.getItem(resetMarker)
    if (marker) {
      const recover = () => {
        if (localStorage.getItem(resetMarker) !== marker) return
        localStorage.removeItem(resetMarker)
        reopen()
      }
      if (navigator.locks) {
        // Queue behind an active reset so a crashed initiator cannot strand peers.
        void navigator.locks.request(resetLock, recover)
      } else {
        const age = Date.now() - Number(marker)
        window.setTimeout(recover, Number.isFinite(age) ? Math.max(0, staleResetMs - age) : 0)
      }
      return true
    }
  } catch {
    /* The app reports unavailable browser storage. */
  }
  return false
}
