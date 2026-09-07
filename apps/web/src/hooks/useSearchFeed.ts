import { resolve } from '@ahead/resolver'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LoadedFeed } from '../lib/feed-loader'
import { searchFeedApi } from '../services/search'
import type {
  SearchErrorReason,
  SearchFeedSession,
  SearchFeedStatus,
  SearchRequest,
} from '../services/search-feed-api'
import { useAuthSession } from '../stores'
import { useFeedStore } from '../stores/feed'

type SearchFailure = { message: string; reason: SearchErrorReason }

export function useSearchFeed(request?: SearchRequest) {
  const authLoading = useAuthSession((state) => state.loading)
  const session = useAuthSession((state) => state.session)
  const profile = useFeedStore((state) => state.profile)
  const [feeds, setFeeds] = useState<LoadedFeed[]>([])
  const [status, setStatus] = useState<SearchFeedStatus>('idle')
  const [error, setError] = useState<SearchFailure>()
  const searchSession = useRef<SearchFeedSession | undefined>(undefined)
  const requestKey = request
    ? 'tag' in request
      ? `tag:${request.tag}`
      : `query:${request.query}`
    : ''

  useEffect(() => {
    searchSession.current?.close()
    searchSession.current = undefined
    setFeeds([])
    setError(undefined)
    setStatus('idle')
    if (authLoading || !request) return
    if (!session) {
      setError({
        message: 'messages.sign_in_to_search_github',
        reason: 'authentication-required',
      })
      setStatus('failed')
      return
    }
    const api = searchFeedApi()
    if (!api) return
    let active = true
    try {
      const opened = api.openSession({
        request,
        receive: (event) => {
          if (!active) return
          if (event.type === 'feed')
            setFeeds((current) => [
              ...current.filter((feed) => feed.sourceLocator !== event.feed.sourceLocator),
              event.feed,
            ])
          else if (event.type === 'error')
            setError({ message: event.message, reason: event.reason })
        },
        status: (next) => {
          if (!active) return
          setStatus(next)
          if (next === 'searching')
            setError((current) => current?.reason === 'incomplete-results' ? current : undefined)
        },
      })
      searchSession.current = opened
      opened.setActive(true)
    } catch (cause) {
      setError({ message: String(cause), reason: 'search-unavailable' })
      setStatus('failed')
    }
    return () => {
      active = false
      searchSession.current?.close()
      searchSession.current = undefined
    }
  }, [authLoading, requestKey, session?.identity.id, session?.providerId])

  const events = useMemo(() => {
    if (!feeds.length) return []
    let timezone = profile.settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { timezone = 'UTC' }
    const hidden = new Set(profile.hidden ?? [])
    return resolve({ feeds, users: [profile], activeProfile: profile, now: new Date(), timezone }).events
      .filter((event) => !hidden.has(event.id) && event.status !== 'cancelled' && event.status !== 'archived')
  }, [feeds, profile])

  const retry = useCallback(() => {
    setError(undefined)
    return searchSession.current?.retry() ?? Promise.resolve()
  }, [])
  const reportVisible = useCallback((index: number) => {
    searchSession.current?.reportVisible(index, events.length)
  }, [events.length])

  return { events, feeds, status, error, retry, reportVisible }
}
