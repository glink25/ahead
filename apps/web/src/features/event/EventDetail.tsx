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
    <article data-event-detail>
      <section
        className="relative min-h-[clamp(380px,58dvh,640px)] overflow-hidden text-white max-[600px]:min-h-[clamp(380px,58dvh,540px)]"
        style={{
          background: 'linear-gradient(145deg,' + poster.gradient.join(',') + ')',
        }}
        aria-labelledby="event-detail-title"
      >
        {poster.url && (
          <img
            className="absolute inset-0 h-full w-full object-cover object-[center_44%]"
            src={poster.url}
            alt=""
            onError={(e) => {
              e.currentTarget.style.opacity = '0'
            }}
          />
        )}
        <div className="absolute inset-0 h-full w-full bg-[linear-gradient(180deg,#07130d4d_0%,#07130d0d_30%,#07130d80_68%,#07130df0_100%),linear-gradient(90deg,#07130d75,transparent_65%)]" />
        <div className="relative mx-auto flex min-h-[clamp(380px,58dvh,640px)] w-[min(100%,920px)] flex-col justify-end px-8 pb-[52px] pt-[calc(var(--header-height)+env(safe-area-inset-top)+36px)] max-[600px]:min-h-[clamp(380px,58dvh,540px)] max-[600px]:px-5 max-[600px]:pb-9">
          <div className="flex items-end justify-between gap-8 max-[600px]:flex-col max-[600px]:items-start max-[600px]:gap-5 [&_h1]:max-w-[720px] [&_h1]:text-balance [&_h1]:text-[clamp(34px,5vw,62px)]! [&_h1]:leading-[1.12]! [&_h1]:tracking-[-1.5px]! max-[600px]:[&_h1]:text-[clamp(34px,10vw,46px)]! [&_.copy-link-control]:text-white max-[600px]:[&_.copy-link-control]:order-first [&_.copy-link-control_.primary-link]:border [&_.copy-link-control_.primary-link]:border-[#ffffff40] [&_.copy-link-control_.primary-link]:bg-[#0a160d66] [&_.copy-link-control_.primary-link]:text-white [&_.copy-link-control_.primary-link]:backdrop-blur-[14px] max-[600px]:[&_.copy-link-control_.primary-link]:px-3.5 max-[600px]:[&_.copy-link-control_.primary-link]:py-[9px] max-[600px]:[&_.copy-link-control_.primary-link]:text-xs [&_.copy-link-control_label]:text-[#ffffffcc]">
            <h1 id="event-detail-title">{pickText(event.title)}</h1>
            <CopyLinkButton url={shareUrl} />
          </div>
          <p className="mt-[22px] text-[clamp(30px,4.5vw,54px)] leading-[1.12]! tracking-[-1px] text-[#e0edbd] max-[600px]:text-[clamp(30px,10vw,44px)]">{countdown.headline}</p>
          {countdown.dateLabel &&
            !countdown.headline.includes(countdown.dateLabel) && (
              <p className="mt-2 text-[13px] text-[#edf2e9d9]">{countdown.dateLabel}</p>
            )}
        </div>
      </section>
      <div className="mx-auto w-[min(100%,760px)] px-6 pb-5 pt-9 max-[600px]:px-5 max-[600px]:pb-3 max-[600px]:pt-[30px] [&>h2]:mx-1 [&>h2]:mb-3 [&>h2]:mt-[30px] [&>h2]:text-base [&>h2]:font-semibold [&>.source-list]:mt-6">
        {!!shared.errors.length && !!event && (
          <details className="feedback" role="status">
            <summary>{t('messages.some_event_sources_could_not_be_opened')}</summary>
            <ul>{shared.errors.map((item) => <li key={item.source}>{item.source}</li>)}</ul>
          </details>
        )}
        {(pickText(event.description) || pickText(event.summary)) && (
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {pickText(event.description) || pickText(event.summary)}
          </p>
        )}
        {own && (
          <div className="my-5 flex items-center gap-5 text-sm">
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
        <div className="my-3 flex gap-2">
          <FavoriteButton event={event} />
          <HideMenu event={event} />
        </div>
        <h2>{t('messages.schedule_history')}</h2>
        <ol className="mx-2.5 my-6 border-l border-line [&_li]:relative [&_li]:list-none [&_li]:pb-7 [&_li]:pl-6 [&_li]:before:absolute [&_li]:before:left-[-4px] [&_li]:before:top-1.5 [&_li]:before:size-[7px] [&_li]:before:rounded-full [&_li]:before:bg-[#91a576] [&_li]:before:content-[''] [&_time]:text-xs [&_time]:text-muted [&_p]:text-xs [&_p]:text-muted [&_h3]:my-2 [&_h3]:text-lg">
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
            <p className="text-xs text-muted [overflow-wrap:anywhere]" key={i}>
              {e.value}
            </p>
          ))}
        <FeedSourceBar event={event} availableFeeds={availableFeeds} subscribedTone="panel" />
      </div>
    </article>
  )
}
