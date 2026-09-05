import { sourceKey } from '@ahead/protocol'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { PageSkeleton } from '../../app/PageSkeleton'
import { pickText } from '../../lib/format'
import { useFeedStore } from '../../stores/feed'
import { CopyLinkButton, ResourceFailure, VisibilityBadge } from './ShareUi'
import { useSharedResource } from './useSharedResource'

export function ChannelDetail() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const key = params.get('source')
  const state = useSharedResource(key, 'event-feed')
  const { profile, act, ready } = useFeedStore()
  if (state.loading) return <PageSkeleton variant="detail" />
  if (state.error || state.resource?.kind !== 'event-feed')
    return <ResourceFailure error={(state.error ?? new Error('Wrong resource type')) as Error & { reason?: string }} />
  const resource = state.resource
  const source = { ...resource.source, kind: 'event-feed' as const }
  const canonical = sourceKey(source)
  const subscribed = profile.subscriptions?.some((item) => sourceKey(item) === canonical)
  return (
    <section className="resource-detail">
      <div className="resource-heading">
        <div>
          <h1>{pickText(resource.feed.feed.name)}</h1>
          <VisibilityBadge resource={resource} />
        </div>
        <CopyLinkButton url={'/channels/view?source=' + encodeURIComponent(canonical)} />
      </div>
      {resource.feed.feed.description && <p>{pickText(resource.feed.feed.description)}</p>}
      {!!resource.feed.feed.tags?.length && (
        <div className="resource-tags">
          {resource.feed.feed.tags.map((tag) => (
            <span key={tag.id}># {pickText(tag.label) || tag.id}</span>
          ))}
        </div>
      )}
      <button
        className={'subscribe ' + (subscribed ? 'subscribed' : '')}
        disabled={!ready}
        aria-pressed={Boolean(subscribed)}
        onClick={() => act({ type: subscribed ? 'unsubscribe' : 'subscribe', source })}
      >
        {subscribed ? t('messages.subscribed') : t('messages.subscribe_to_channel')}
      </button>
      <h2>{t('messages.events')}</h2>
      <div className="resource-list">
        {(resource.feed.feed.events ?? []).map((event) => (
          <Link className="resource-card" key={event.id} to={'/events/' + encodeURIComponent(event.id) + '?source=' + encodeURIComponent(canonical)}>
            <strong>{pickText(event.title)}</strong>
            <small>{pickText(event.summary) || pickText(event.description)}</small>
          </Link>
        ))}
      </div>
      <details className="technical-details">
        <summary>{t('messages.channel_details')}</summary>
        <p>{canonical}</p>
      </details>
    </section>
  )
}
