import { requestSync } from '../data/scheduler'
import { useFeedStore } from '../stores/feed'
import { useAuthSession } from '../stores'
import { marketApi } from './market'
import { revalidateSearch } from './search'

/** One owner for browser lifecycle triggers; writable and read-only paths stay separate. */
export function startDataRefresh() {
  const refresh = (force = false) => {
    requestSync(true)
    marketApi().revalidate(force)
    revalidateSearch()
    const state = useFeedStore.getState()
    if (state.hydrated && !useAuthSession.getState().loading)
      void state.refresh({ force: false, restart: false })
  }
  const online = () => refresh(true)
  const focus = () => refresh()
  const offline = () => requestSync(true)
  window.addEventListener('online', online)
  window.addEventListener('focus', focus)
  window.addEventListener('offline', offline)
  const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 60_000)
  return () => {
    clearInterval(timer)
    window.removeEventListener('online', online)
    window.removeEventListener('focus', focus)
    window.removeEventListener('offline', offline)
  }
}
