import { resolve } from '@ahead/resolver'
import type { LoadedFeed } from '../../lib/feed-loader'
import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageSkeleton } from '../../app/PageSkeleton'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { marketApi } from '../../services/market'
import type { SearchErrorReason } from '../../services/market-api'
import { useAuthSession } from '../../stores'
import { useFeedStore } from '../../stores/feed'
import { PosterCard } from '../discover/PosterCard'

export function SearchView() {
  useFeatureTranslations('search')
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const query = params.get('q')?.trim() ?? ''
  const tag = params.get('tag')?.trim() ?? ''
  const [input, setInput] = useState(query)
  const [feeds, setFeeds] = useState<LoadedFeed[]>([])
  const [loading, setLoading] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<{ message: string; reason: SearchErrorReason }>()
  const [retry, setRetry] = useState(0)
  const authLoading = useAuthSession((state) => state.loading)
  const session = useAuthSession((state) => state.session)
  const profile = useFeedStore((state) => state.profile)

  useEffect(() => setInput(query), [query])
  useEffect(() => {
    if (authLoading || (!query && !tag)) {
      setFeeds([])
      setComplete(false)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setFeeds([])
    setError(undefined)
    setComplete(false)
    setLoading(true)
    void (async () => {
      for await (const event of marketApi().search.stream({
        ...(tag ? { tag } : { query }),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return
        if (event.type === 'feed')
          setFeeds((current) => [
            ...current.filter((feed) => feed.sourceLocator !== event.feed.sourceLocator),
            event.feed,
          ])
        else if (event.type === 'error') setError({ message: event.message, reason: event.reason })
        else if (event.complete) setComplete(true)
      }
    })().finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [authLoading, query, tag, session?.identity.id, session?.providerId, retry])

  const events = useMemo(() => {
    if (!feeds.length) return []
    let timezone = profile.settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { timezone = 'UTC' }
    const hidden = new Set(profile.hidden ?? [])
    return resolve({ feeds, users: [profile], activeProfile: profile, now: new Date(), timezone }).events
      .filter((event) => !hidden.has(event.id) && event.status !== 'cancelled' && event.status !== 'archived')
  }, [feeds, profile])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = input.trim()
    if (value) navigate('/search?q=' + encodeURIComponent(value))
  }
  return (
    <section className="search-view">
      <form className="search-form" role="search" onSubmit={submit}>
        <Search aria-hidden />
        <input
          aria-label={t('messages.search_events')}
          placeholder={t('messages.search_placeholder')}
          value={tag ? '#' + tag : input}
          readOnly={Boolean(tag)}
          onChange={(event) => setInput(event.target.value)}
        />
        {(tag || input) && (
          <button
            type="button"
            aria-label={t('messages.clear_search')}
            onClick={() => {
              setInput('')
              navigate('/search', { replace: true })
            }}
          ><X /></button>
        )}
        {!tag && <button type="submit">{t('messages.search')}</button>}
      </form>
      {!query && !tag ? (
        <div className="empty-view"><h1>{t('messages.search_events')}</h1></div>
      ) : loading && !events.length ? (
        <PageSkeleton variant="poster" />
      ) : error?.reason === 'authentication-required' || error?.reason === 'authentication-expired' ? (
        <div className="empty-view">
          <h1>{t(error.reason === 'authentication-required' ? 'messages.sign_in_to_search' : 'messages.sign_in_expired')}</h1>
          <Link className="primary-link" to={'/login?returnTo=' + encodeURIComponent(location.pathname + location.search)}>{t('messages.sign_in_to_github')}</Link>
        </div>
      ) : !events.length && complete ? (
        <div className="empty-view"><h1>{t('messages.no_search_results')}</h1></div>
      ) : error && error.reason !== 'incomplete-results' && !events.length ? (
        <div className="empty-view">
          <h1>{displayMessage(error.message)}</h1>
          <button className="primary-link" onClick={() => setRetry((value) => value + 1)}>{t('messages.retry')}</button>
        </div>
      ) : (
        <div className="discover-scroll search-results" aria-label={t('messages.search_results')}>
          {error && <p className="search-warning" role="status">{displayMessage(error.message)}</p>}
          {events.map((event, index) => {
            const sources = event.sourceLocators.filter((source) => source.startsWith('github:'))
            const href = '/events/' + encodeURIComponent(event.id) + (sources.length ? '?' + sources.map((source) => 'source=' + encodeURIComponent(source)).join('&') : '')
            return <div className="poster-slot" key={event.id}><PosterCard event={event} index={index} availableFeeds={feeds} eventHref={href} /></div>
          })}
        </div>
      )}
    </section>
  )
}
