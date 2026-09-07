import { LoaderCircle, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { TagChip } from '@ahead/ui'
import type { AddressedEvent } from '../../services/market-api'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { useSearchFeed } from '../../hooks/useSearchFeed'
import type { LoadedFeed } from '../../lib/feed-loader'
import { countdownFor, pickText } from '../../lib/format'
import { posterFor } from '../../lib/media'
import { primaryFeedForEvent } from '../../lib/primary-feed'
import { tagLabel } from '../../lib/tag-label'
import { useFeedStore } from '../../stores/feed'
import { FavoriteButton, FeedSourceBar } from '../discover/PosterCard'
import { eventPath } from '../../services/resource-address'

function SearchResultCard({
  event,
  feeds,
  href,
  eager,
}: {
  event: AddressedEvent
  feeds: LoadedFeed[]
  href: string
  eager: boolean
}) {
  const { t, i18n } = useTranslation()
  const profile = useFeedStore((state) => state.profile)
  const feed = primaryFeedForEvent(event, feeds)
  const poster = posterFor(event, {
    locator: feed?.locator,
    headSha: feed?.headSha,
    allowRemoteImages: !profile.settings?.privacyRemoteImages,
  })
  const countdown = countdownFor(event)

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center gap-5 p-4 max-[600px]:gap-3 max-[600px]:p-3">
        <Link
          className="h-[124px] w-[180px] shrink-0 overflow-hidden rounded-xl max-[600px]:h-[106px] max-[600px]:w-[112px] max-[600px]:rounded-[10px]"
          to={href}
          tabIndex={-1}
          aria-hidden
          style={{ background: poster.gradient[1] }}
        >
          {poster.url && (
            <img
              className="h-full w-full object-cover"
              src={poster.url}
              alt=""
              loading={eager ? 'eager' : 'lazy'}
              onError={(error) => {
                error.currentTarget.style.opacity = '0'
              }}
            />
          )}
        </Link>
        <div className="min-w-0 flex-1 py-1">
          <small className="text-[13px] text-[#849953] max-[600px]:text-[11px]">
            {countdown.dateLabel || t('messages.date_tbd')}
          </small>
          <h2 className="my-1.5 text-lg font-semibold max-[600px]:text-base">
            <Link to={href}>{pickText(event.title)}</Link>
          </h2>
          <p className="line-clamp-2 text-[13px] leading-[1.6] text-[var(--muted)] max-[600px]:text-[11px]">
            {pickText(event.summary) || pickText(event.description)}
          </p>
          {!!event.tags?.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {event.tags.map((tag) => (
                <Link key={tag} to={'/search?tag=' + encodeURIComponent(tag)}>
                  <TagChip className="inline-flex rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]">
                    # {tagLabel(tag, event, feeds, i18n.resolvedLanguage)}
                  </TagChip>
                </Link>
              ))}
            </div>
          )}
        </div>
        <FavoriteButton event={event} />
      </div>
      <footer className="border-t border-line px-4 py-3 max-[600px]:px-3">
        <FeedSourceBar event={event} availableFeeds={feeds} subscribedTone="surface" />
      </footer>
    </article>
  )
}

export function SearchView() {
  useFeatureTranslations('search')
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const query = params.get('q')?.trim() ?? ''
  const tag = params.get('tag')?.trim() ?? ''
  const [input, setInput] = useState(query)
  const results = useRef<HTMLDivElement>(null)
  const loadMore = useRef<HTMLDivElement>(null)
  const request = tag ? { tag } as const : query ? { query } as const : undefined
  const { events, feeds, status, error, retry, reportVisible } = useSearchFeed(request)

  useEffect(() => setInput(query), [query])
  useEffect(() => {
    const root = results.current
    const target = loadMore.current
    if (!root || !target || !events.length) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) reportVisible(events.length - 1)
    }, { root, rootMargin: '240px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [events.length, reportVisible])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = input.trim()
    if (value) navigate('/search?q=' + encodeURIComponent(value))
  }
  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-surface">
      <form className="flex items-center gap-2.5 border-b border-line px-[max(20px,calc((100%-804px)/2))] py-3 [&>.lucide]:w-[18px] [&>.lucide]:text-muted [&>button]:flex-none [&>button]:rounded-[14px] [&>button]:bg-surface [&>button]:px-2.5 [&>button]:py-[7px] [&>button_.lucide]:w-[17px] [&>input]:min-w-0 [&>input]:flex-1 [&>input]:border-0 [&>input]:bg-transparent [&>input]:text-base" role="search" onSubmit={submit}>
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
        <div className="flex min-h-[180px] items-center justify-center gap-2.5 text-sm text-muted" role="status" aria-label={t('messages.searching')}>
          <LoaderCircle className="size-[22px] animate-[spinner-turn_1s_linear_infinite] text-muted motion-reduce:animate-none" />
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
          ref={results}
          className="min-h-0 overflow-y-auto overscroll-y-contain"
          aria-label={t('messages.search_results')}
        >
          <div className="mx-auto grid max-w-[804px] gap-4 px-7 py-6 pb-[calc(40px+env(safe-area-inset-bottom))] max-[600px]:px-5 max-[600px]:py-4">
            {error && (
              <p
                className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]"
                role="status"
              >
                {displayMessage(error.message)}
              </p>
            )}
            {events.map((event, index) => {
              const href = eventPath(event)
              return <SearchResultCard key={event.id} event={event} feeds={feeds} href={href} eager={index === 0} />
            })}
            <div ref={loadMore} className="h-px" aria-hidden />
          </div>
        </div>
      )}
    </section>
  )
}
