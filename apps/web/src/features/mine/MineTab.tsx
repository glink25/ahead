import { PageSkeleton } from '../../app/PageSkeleton'
import { useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { useFeedView } from '../../hooks/useFeedView'
import { countdownFor, pickText } from '../../lib/format'
import { FavoriteButton } from '../discover/PosterCard'
import { MonthView } from './MonthView'
import { posterFor } from '../../lib/media'
import { useFeedStore } from '../../stores/feed'
import type { AddressedEvent } from '../../services/market-api'
import { eventPath } from '../../services/resource-address'
import { partitionTimelineEvents } from './timeline'

export function MineTab() {
  useFeatureTranslations('mine')
  const { t } = useTranslation()

  const { mine, resolved } = useFeedView()
  const { feeds, profile, hydrated } = useFeedStore()
  const weekStartsOn =
    profile.settings?.weekStartsOn === 'sunday' ||
    profile.settings?.weekStartsOn === 'monday'
      ? profile.settings.weekStartsOn
      : undefined
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
  if (!hydrated) return <PageSkeleton variant="list" />
  const { history, current } = partitionTimelineEvents(mine)
  const posterForEvent = (event: AddressedEvent) => {
    const feed = feeds.find((item) =>
      event.sourceLocators.includes(item.sourceLocator),
    )
    return posterFor(event, {
      sourceLocator: feed?.sourceLocator,
      version: feed?.version,
      allowRemoteImages: !profile.settings?.privacyRemoteImages,
    })
  }
  const empty = (
    <div className="empty-view">
      <span className="text-[50px] text-[#94a676]">
        <Plus />
      </span>
      <h2>{t('messages.nothing_planned_yet')}</h2>
      <Link className="primary-link" to="/studio">
        {t('messages.new_event')}
      </Link>
      <Link to="/discover">{t('messages.explore')}</Link>
    </div>
  )
  const renderEvents = (events: AddressedEvent[]) => {
    let previous = ''
    return events.map((event) => {
      const countdown = countdownFor(event)
      const group = countdown.headline
      const heading = group !== previous
      previous = group
      const poster = posterForEvent(event)
      return (
        <section key={event.id}>
          {heading && <h2 className="relative py-3 pl-[18px] pt-[22px] text-[13px] font-semibold text-muted before:absolute before:left-0 before:top-7 before:size-1.5 before:rounded-full before:bg-[#91a576] before:content-['']">{group}</h2>}
          <div className="ml-0.5 flex items-center gap-5 border-l border-line pb-6 pl-[18px] max-[600px]:gap-3 max-[600px]:pl-3 max-[600px]:[&_.icon-action]:min-w-8">
            <Link
              className="h-[124px] w-[180px] shrink-0 overflow-hidden rounded-xl max-[600px]:h-[106px] max-[600px]:w-28 max-[600px]:rounded-[10px] [&_img]:h-full [&_img]:w-full [&_img]:object-cover"
              to={eventPath(event)}
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
              className="min-w-0 flex-1 [&_h3]:my-1.5 [&_h3]:text-lg [&_h3]:font-semibold max-[600px]:[&_h3]:text-base [&_small]:text-[13px] [&_small]:text-[#849953] max-[600px]:[&_small]:text-[11px] [&_p]:line-clamp-2 [&_p]:text-[13px] [&_p]:leading-[1.6] [&_p]:text-muted max-[600px]:[&_p]:text-[11px]"
              to={eventPath(event)}
            >
              <small>{countdown.dateLabel || t('messages.date_tbd')}</small>
              <h3>{pickText(event.title)}</h3>
              <p>{pickText(event.summary) || pickText(event.description)}</p>
            </Link>
            <FavoriteButton event={event} />
          </div>
        </section>
      )
    })
  }
  return (
    <div className="relative flex h-full flex-col">
      {calendar ? (
        <MonthView
          events={mine}
          timezone={resolved.timezone}
          weekStartsOn={weekStartsOn}
          posterForEvent={posterForEvent}
          search={savedSearch.current}
        />
      ) : (
        <div
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto px-7 pb-[110px] pt-0 max-[600px]:px-5"
          ref={timeline}
          onScroll={(e) => {
            scroll.current = e.currentTarget.scrollTop
          }}
        >
          {!mine.length ? empty : (
            <div className="mx-auto max-w-[804px] [&>.empty-view]:h-auto">
              {!!history.length && (
                <details className="group">
                  <summary className="flex list-none items-center gap-2.5 px-0 pb-2 pt-[18px] text-[13px] font-semibold text-muted before:h-px before:flex-1 before:bg-line before:content-[''] after:h-px after:flex-1 after:bg-line after:content-[''] [&::-webkit-details-marker]:hidden [&_.lucide]:transition-transform group-open:[&_.lucide]:rotate-180">
                    <span>
                      {t('messages.history_events')} · {history.length}
                    </span>
                    <ChevronDown />
                  </summary>
                  <div className="pb-1.5">{renderEvents(history)}</div>
                </details>
              )}
              {current.length ? renderEvents(current) : empty}
            </div>
          )}
        </div>
      )}
      <Link className="absolute bottom-[calc(24px+env(safe-area-inset-bottom))] right-[max(24px,calc((100%-804px)/2))] z-5 grid size-[58px] place-items-center rounded-full bg-accent text-[32px] text-[#2d3d22] shadow-[0_8px_26px_#0002] max-[600px]:right-5 max-[600px]:size-[54px] [&_.lucide]:size-[26px]" to="/studio" aria-label={t('messages.new_event')}>
        <Plus />
      </Link>
    </div>
  )
}
