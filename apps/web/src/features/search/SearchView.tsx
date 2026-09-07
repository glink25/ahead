import { LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { useSearchFeed } from '../../hooks/useSearchFeed'
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
  const request = tag ? { tag } as const : query ? { query } as const : undefined
  const { events, feeds, status, error, retry, reportVisible } = useSearchFeed(request)

  useEffect(() => setInput(query), [query])
  useEffect(() => {
    if (events.length) reportVisible(0)
  }, [events.length, reportVisible])
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
      ) : status === 'searching' && !events.length ? (
        <div className="search-loading" role="status" aria-label={t('messages.searching')}>
          <LoaderCircle className="loading-spinner" />
          <span>{t('messages.searching')}</span>
        </div>
      ) : error?.reason === 'authentication-required' || error?.reason === 'authentication-expired' ? (
        <div className="empty-view">
          <h1>{t(error.reason === 'authentication-required' ? 'messages.sign_in_to_search' : 'messages.sign_in_expired')}</h1>
          <Link className="primary-link" to={'/login?returnTo=' + encodeURIComponent(location.pathname + location.search)}>{t('messages.sign_in_to_github')}</Link>
        </div>
      ) : !events.length && status === 'complete' ? (
        <div className="empty-view"><h1>{t('messages.no_search_results')}</h1></div>
      ) : error && error.reason !== 'incomplete-results' && !events.length ? (
        <div className="empty-view">
          <h1>{displayMessage(error.message)}</h1>
          <button className="primary-link" onClick={() => void retry()}>{t('messages.retry')}</button>
        </div>
      ) : (
        <div
          className="discover-scroll search-results"
          aria-label={t('messages.search_results')}
          onScroll={(event) => {
            const height = event.currentTarget.clientHeight || 1
            reportVisible(Math.round(event.currentTarget.scrollTop / height))
          }}
        >
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
