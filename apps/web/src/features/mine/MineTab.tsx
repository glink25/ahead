import { PageSkeleton } from '../../app/PageSkeleton'
import { useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { useFeedView } from '../../hooks/useFeedView'
import { countdownFor, pickText } from '../../lib/format'
import { FavoriteButton } from '../discover/PosterCard'
import { MonthView } from './MonthView'
import { posterFor } from '../../lib/media'
import { useFeedStore } from '../../stores/feed'

export function MineTab() {
  useFeatureTranslations('mine')
  const { t } = useTranslation()

  const { mine, resolved } = useFeedView()
  const { feeds, profile, ready } = useFeedStore()
  const location = useLocation()
  const savedSearch = useRef('')
  if (location.pathname === '/mine') savedSearch.current = location.search
  const params = new URLSearchParams(savedSearch.current)
  const calendar = params.get('view') === 'calendar'
  const timeline = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  useEffect(() => {
    if (!calendar && timeline.current)
      timeline.current.scrollTop = scroll.current
  }, [calendar])
  let previous = ''
  if (!ready) return <PageSkeleton variant="list" />
  return (
    <div className="mine-view">
      {calendar ? (
        <MonthView
          events={mine}
          timezone={resolved.timezone}
          search={savedSearch.current}
        />
      ) : (
        <div
          className="tab-scroll"
          ref={timeline}
          onScroll={(e) => {
            scroll.current = e.currentTarget.scrollTop
          }}
        >
          {!mine.length ? (
            <div className="empty-view">
              <span className="empty-orbit">
                <Plus />
              </span>
              <h2>{t('messages.nothing_planned_yet')}</h2>
              <Link className="primary-link" to="/studio">
                 {t('messages.new_event')} </Link>
              <Link to="/discover">{t('messages.explore')}</Link>
            </div>
          ) : (
            <div className="timeline">
              {mine.map((event) => {
                const countdown = countdownFor(event)
                const group = countdown.headline
                const heading = group !== previous
                previous = group
                const feed = feeds.find((f) =>
                  event.sourceLocators.includes(f.sourceLocator),
                )
                const poster = posterFor(event, {
                  locator: feed?.locator,
                  headSha: feed?.headSha,
                  allowRemoteImages: !profile.settings?.privacyRemoteImages,
                })
                return (
                  <section key={event.id}>
                    {heading && <h2 className="bucket-heading">{group}</h2>}
                    <div className="timeline-row">
                      <Link
                        className="timeline-thumb"
                        to={'/events/' + encodeURIComponent(event.id)}
                        tabIndex={-1}
                        aria-hidden
                        style={{ background: poster.gradient[1] }}
                      >
                        {poster.url && (
                          <img
                            src={poster.url}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.opacity = '0'
                            }}
                          />
                        )}
                      </Link>
                      <Link
                        className="timeline-copy"
                        to={'/events/' + encodeURIComponent(event.id)}
                      >
                        <small>
                          {countdown.dateLabel || t('messages.date_tbd')}
                        </small>
                        <h3>{pickText(event.title)}</h3>
                        <p>
                          {pickText(event.summary) ||
                            pickText(event.description)}
                        </p>
                      </Link>
                      <FavoriteButton event={event} />
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      )}
      <Link className="create-fab" to="/studio" aria-label={t('messages.new_event')}>
        <Plus />
      </Link>
    </div>
  )
}
