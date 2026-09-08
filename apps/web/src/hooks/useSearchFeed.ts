import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAuthSession } from '../stores'
import { useFeedStore } from '../stores/feed'
import { marketApi } from '../services/market'
import { searchQuery } from '../services/search'
import type { SearchRequest } from '../services/search-feed-api'
import type { SearchSnapshot } from '../services/search-query'
const empty: SearchSnapshot = { feeds: [], status: 'idle' }
const snapshot = () => empty
const subscribe = () => () => {}
export function useSearchFeed(request?: SearchRequest) {
  const auth = useAuthSession()
  const profile = useFeedStore((state) => state.profile)
  const key = request ? JSON.stringify(request) : ''
  const query = useMemo(() => request ? searchQuery(request) : undefined, [key, auth.session, auth.verified, auth.loading])
  const state = useSyncExternalStore(query?.subscribe ?? subscribe, query?.snapshot ?? snapshot)
  const events = useMemo(() => {
    const hidden = new Set(profile.hidden ?? [])
    return marketApi().events.resolve({ feeds: state.feeds, users: [], activeProfile: profile, timezone: profile.settings?.timezone }).events.filter((event) => !hidden.has(event.id) && event.status !== 'cancelled' && event.status !== 'archived')
  }, [state.feeds, profile])
  const reportVisible = useCallback((index: number) => query?.reportVisible(index, events.length), [query, events.length])
  return { ...state, events, retry: query?.refresh ?? (() => Promise.resolve()), reportVisible }
}
