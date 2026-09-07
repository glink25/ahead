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
import { identityScope, viewStore } from '../data/storage'
import { createValidator } from '@ahead/schema'

type SearchFailure = { message: string; reason: SearchErrorReason }
type SearchSnapshot = { feeds: LoadedFeed[]; storedAt: string }
const validator = createValidator()

function limitedFeeds(feeds: LoadedFeed[]) {
  let remaining = 200
  const result: LoadedFeed[] = []
  for (const feed of feeds) {
    if (remaining <= 0) break
    const events = (feed.feed.events ?? []).slice(0, remaining)
    if (events.length) result.push({ ...feed, feed: { ...feed.feed, events } })
    remaining -= events.length
  }
  return result
}

export function useSearchFeed(request?: SearchRequest) {
  const authLoading = useAuthSession((state) => state.loading)
  const session = useAuthSession((state) => state.session)
  const verified = useAuthSession((state) => state.verified)
  const profile = useFeedStore((state) => state.profile)
  const [feeds, setFeeds] = useState<LoadedFeed[]>([])
  const [status, setStatus] = useState<SearchFeedStatus>('idle')
  const [error, setError] = useState<SearchFailure>()
  const searchSession = useRef<SearchFeedSession | undefined>(undefined)
  const requestKey = request
    ? 'tag' in request
      ? `tag:${request.tag!.trim().toLowerCase()}`
      : `query:${request.query.normalize('NFKC').trim()}`
    : ''

  useEffect(() => {
    searchSession.current?.close()
    searchSession.current = undefined
    setFeeds([])
    setError(undefined)
    setStatus('idle')
    let active = true
    if (!request) return
    const snapshots = viewStore(identityScope(session), 'search', 20)
    const save = (next: LoadedFeed[]) => {
      const value = limitedFeeds(next)
      void snapshots.set(requestKey, {
        feeds: value,
        storedAt: new Date().toISOString(),
      } satisfies SearchSnapshot).catch(() => {})
    }
    void (async () => {
      let cached = await snapshots.get<SearchSnapshot>(requestKey).catch(() => undefined)
      if (!active) return
      if (cached && cached.feeds.some((feed) => !validator.validate('event-feed', feed.feed).ok)) {
        await snapshots.delete(requestKey).catch(() => {})
        cached = undefined
      }
      if (cached?.feeds.length) {
        setFeeds(cached.feeds)
        setStatus('complete')
        void snapshots.set(requestKey, {
          ...cached,
          storedAt: new Date().toISOString(),
        }).catch(() => {})
      }
      if (authLoading) return
      if (!session) {
        if (!cached?.feeds.length) {
          setError({ message: 'messages.sign_in_to_search_github', reason: 'authentication-required' })
          setStatus('failed')
        }
        return
      }
      if (!verified) return
      if (!navigator.onLine) {
        if (!cached?.feeds.length) {
          setError({ message: 'messages.github_search_unavailable', reason: 'search-unavailable' })
          setStatus('failed')
        }
        return
      }
      const api = searchFeedApi()
      if (!api) return
      const opened = api.openSession({
        request,
        receive: (event) => {
          if (!active) return
          if (event.type === 'feed') setFeeds((current) => {
            const next = [
              ...current.filter((feed) => feed.sourceLocator !== event.feed.sourceLocator),
              event.feed,
            ]
            save(next)
            return next
          })
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
    })().catch((cause) => {
      if (active) {
        setError({ message: String(cause), reason: 'search-unavailable' })
        setStatus('failed')
      }
    })
    return () => {
      active = false
      searchSession.current?.close()
      searchSession.current = undefined
    }
  }, [authLoading, verified, requestKey, session?.identity.id, session?.providerId])

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
