import { PageSkeleton } from '../../app/PageSkeleton'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { useData, deleteEvent } from '../../data/local'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useFeedView } from '../../hooks/useFeedView'
import { useFeedStore } from '../../stores/feed'
import {
  countdownFor,
  pickText,
  describeTemporal,
  CONFIDENCE_LABELS,
} from '../../lib/format'
import {
  EvidenceLinks,
  FavoriteButton,
  FeedSourceBar,
  HideMenu,
} from '../discover/PosterCard'
import {
  loadCachedSharedResource,
  loadSharedResource,
} from '../../services/shared-resource'
import { mergeEvents } from '@ahead/resolver'
import type { LoadedFeed } from '../../lib/feed-loader'
import { sourceKey } from '@ahead/protocol'
import { CopyLinkButton, ResourceFailure } from '../share/ShareUi'
import { posterFor } from '../../lib/media'
import { primaryFeedForEvent } from '../../lib/primary-feed'
import { useAuthSession } from '../../stores'
export function EventDetail() {
  useFeatureTranslations('event')
  const { t, i18n } = useTranslation()

  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { db } = useData()
  const [error, setError] = useState('')
  const { resolved } = useFeedView()
  const { refreshing, hydrated, feeds, profile } = useFeedStore()
  const verified = useAuthSession((state) => state.verified)
  const linkedSources = useMemo(
    () => [...new Set(new URLSearchParams(location.search).getAll('source'))],
    [location.search],
  )
  const [shared, setShared] = useState<{
    feeds: LoadedFeed[]
    errors: { source: string; error: Error }[]
    loading: boolean
  }>({ feeds: [], errors: [], loading: false })
  useEffect(() => {
    if (!linkedSources.length) {
      setShared({ feeds: [], errors: [], loading: false })
      return
    }
    if (linkedSources.length > 12) {
      setShared({
        feeds: [],
        errors: [{
          source: '',
          error: Object.assign(new Error('Too many event sources'), { reason: 'invalid' }),
        }],
        loading: false,
      })
      return
    }
    const controller = new AbortController()
    let restoredFeeds: LoadedFeed[] = []
    setShared({ feeds: [], errors: [], loading: true })
    void (async () => {
      const cached = await Promise.all(
        linkedSources.map((key) => loadCachedSharedResource(key, 'event-feed')),
      )
      if (controller.signal.aborted) return
      restoredFeeds = cached.flatMap((resource) =>
        resource?.kind === 'event-feed' ? [resource.feed] : [],
      )
      if (restoredFeeds.length || !navigator.onLine)
        setShared({ feeds: restoredFeeds, errors: [], loading: false })
      if (!navigator.onLine) return
      const results = await Promise.allSettled(
        linkedSources.map((key) => loadSharedResource(key, 'event-feed', controller.signal)),
      )
      if (controller.signal.aborted) return
      const feeds = results.flatMap((result) =>
          result.status === 'fulfilled' && result.value.kind === 'event-feed'
            ? [result.value.feed]
            : [],
        )
      setShared({
        feeds: feeds.length ? feeds : restoredFeeds,
        errors: results.flatMap((result, index) =>
          result.status === 'rejected'
            ? [{
                source: linkedSources[index]!,
                error: result.reason instanceof Error
                  ? result.reason
                  : new Error(String(result.reason)),
              }]
            : [],
        ),
        loading: false,
      })
    })().catch((error) => {
      if (!controller.signal.aborted)
        setShared({
          feeds: restoredFeeds,
          errors: [{ source: '', error: error instanceof Error ? error : new Error(String(error)) }],
          loading: false,
        })
    })
    return () => controller.abort()
  }, [linkedSources, verified])
  const sharedEvent = useMemo(
    () => mergeEvents(
      shared.feeds.flatMap((feed) =>
        (feed.feed.events ?? [])
          .filter((event) => event.id === id)
          .map((event) => ({ event, sourceLocator: feed.sourceLocator })),
      ),
    )[0],
    [shared.feeds, id],
  )
  const localEvent = resolved.events.find((e) => e.id === id)
  const event = linkedSources.length ? sharedEvent : localEvent
  if (!hydrated || shared.loading || (!linkedSources.length && refreshing && !event))
    return <PageSkeleton variant="detail" />
  if (!event && shared.errors.length)
    return <ResourceFailure error={shared.errors[0]!.error as Error & { reason?: string }} />
  if (!event)
    return (
      <div className="empty-view">
        {t('messages.event_not_found_it_may_have_been_removed_or_be_temporarily_unavailable')}
      </div>
    )
  const own = event.sourceLocators.some((s) => s === 'personal:' + db?.active)
  const countdown = countdownFor(event)
  const space = db?.spaces[db.active]
  const shareSources = linkedSources.length
    ? linkedSources
    : event.sourceLocators.flatMap((value) => {
        if (!value.startsWith('personal:')) return value.startsWith('github:') ? [value] : []
        return space?.feed && !space.pending.length
          ? [sourceKey({
              locator: 'github:' + space.feed.owner + '/' + space.feed.repo,
              manifestPath: space.feed.path,
            })]
          : []
      })
  const shareUrl = shareSources.length
    ? '/events/' + encodeURIComponent(event.id) + '?' +
      [...new Set(shareSources)].map((value) => 'source=' + encodeURIComponent(value)).join('&')
    : undefined
  const availableFeeds = linkedSources.length ? shared.feeds : feeds
  const primaryFeed = primaryFeedForEvent(event, availableFeeds)
  const poster = posterFor(event, {
    locator: primaryFeed?.locator,
    headSha: primaryFeed?.headSha,
    allowRemoteImages: !profile.settings?.privacyRemoteImages,
  })
  return (
    <article className="event-detail">
      <section
        className="event-detail-hero"
        style={{
          background: 'linear-gradient(145deg,' + poster.gradient.join(',') + ')',
        }}
        aria-labelledby="event-detail-title"
      >
        {poster.url && (
          <img
            className="event-detail-hero-image"
            src={poster.url}
            alt=""
            onError={(e) => {
              e.currentTarget.style.opacity = '0'
            }}
          />
        )}
        <div className="event-detail-hero-shade" />
        <div className="event-detail-hero-content">
          <div className="event-detail-heading">
            <h1 id="event-detail-title">{pickText(event.title)}</h1>
            <CopyLinkButton url={shareUrl} />
          </div>
          <p className="detail-countdown">{countdown.headline}</p>
          {countdown.dateLabel &&
            !countdown.headline.includes(countdown.dateLabel) && (
              <p className="event-detail-date">{countdown.dateLabel}</p>
            )}
        </div>
      </section>
      <div className="event-detail-body">
        {!!shared.errors.length && !!event && (
          <details className="feedback" role="status">
            <summary>{t('messages.some_event_sources_could_not_be_opened')}</summary>
            <ul>{shared.errors.map((item) => <li key={item.source}>{item.source}</li>)}</ul>
          </details>
        )}
        {(pickText(event.description) || pickText(event.summary)) && (
          <p className="event-detail-description">
            {pickText(event.description) || pickText(event.summary)}
          </p>
        )}
        {own && (
          <div className="personal-actions">
            <Link
              className="primary-link"
              to={'/studio?event=' + encodeURIComponent(event.id)}
            >
               {t('messages.edit')} </Link>
            <button
              onClick={() => {
                if (db)
                  void deleteEvent(db.active, event.id)
                    .then(() => navigate('/mine', { replace: true }))
                    .catch(() => setError('messages.could_not_save_deletion_please_retry'))
              }}
            >
               {t('messages.delete')} </button>
          </div>
        )}
        {error && <p role="alert">{displayMessage(error)}</p>}
        <div className="detail-actions">
          <FavoriteButton event={event} />
          <HideMenu event={event} />
        </div>
        <h2>{t('messages.schedule_history')}</h2>
        <ol className="schedule-timeline">
          {[...event.schedule]
            .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
            .map((entry) => (
              <li key={entry.id}>
                <time>
                  {new Date(entry.recordedAt).toLocaleDateString(i18n.resolvedLanguage)}
                </time>
                <h3>{describeTemporal(entry.value)}</h3>
                <p>
                  {entry.confidence && t(CONFIDENCE_LABELS[entry.confidence])}
                  {entry.source && ' · ' + entry.source}
                </p>
                <EvidenceLinks evidence={entry.evidence} />
              </li>
            ))}
        </ol>
        <h2>{t('messages.sources')}</h2>
        <EvidenceLinks evidence={event.evidence} />
        {event.evidence
          ?.filter((e) => e.kind === 'citation' || e.kind === 'note')
          .map((e, i) => (
            <p className="citation" key={i}>
              {e.value}
            </p>
          ))}
        <FeedSourceBar event={event} availableFeeds={availableFeeds} />
      </div>
    </article>
  )
}
