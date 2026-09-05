import { PageSkeleton } from '../../app/PageSkeleton'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { useData, deleteEvent } from '../../data/local'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
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
export function EventDetail() {
  useFeatureTranslations('event')
  const { t, i18n } = useTranslation()

  const { id } = useParams()
  const navigate = useNavigate()
  const { db } = useData()
  const [error, setError] = useState('')
  const { resolved } = useFeedView()
  const { loading, ready } = useFeedStore()
  const event = resolved.events.find((e) => e.id === id)
  if (!ready || (loading && !event)) return <PageSkeleton variant="detail" />
  if (!event)
    return (
      <div className="empty-view">
        {t('messages.event_not_found_it_may_have_been_removed_or_be_temporarily_unavailable')}
      </div>
    )
  const own = event.sourceLocators.some((s) => s === 'personal:' + db?.active)
  const countdown = countdownFor(event)
  return (
    <article className="event-detail">
      <h1>{pickText(event.title)}</h1>
      <p className="detail-countdown">{countdown.headline}</p>
      <p>{pickText(event.description) || pickText(event.summary)}</p>
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
      <FeedSourceBar event={event} />
    </article>
  )
}
