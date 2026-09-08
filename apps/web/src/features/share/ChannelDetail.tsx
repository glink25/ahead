import { useTranslation } from 'react-i18next'
import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { PageSkeleton } from '../../app/PageSkeleton'
import { pickText } from '../../lib/format'
import { useFeedStore } from '../../stores/feed'
import { CopyLinkButton, ResourceFailure, VisibilityBadge } from './ShareUi'
import { useAddressedResource } from './useAddressedResource'
import {
  addressKey,
  eventPath,
  parseResourceAddress,
  resourcePath,
  sourceFromAddress,
} from '../../services/resource-address'
import { sourceKey } from '@ahead/protocol'

export function ChannelDetail() {
  const { t } = useTranslation()
  const { '*': sourcePath } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const address = useMemo(() => {
    try { return parseResourceAddress(sourcePath) } catch { return undefined }
  }, [sourcePath])
  const state = useAddressedResource(address, 'event-feed')
  const { profile, act, hydrated } = useFeedStore()
  useEffect(() => {
    const next = state.resource?.address
    if (!address || !next || addressKey(address) === addressKey(next)) return
    navigate(resourcePath('event-feed', next) + location.search + location.hash, { replace: true })
  }, [address, state.resource, navigate, location.search, location.hash])
  if (state.loading) return <PageSkeleton variant="detail" />
  if (!state.resource || state.resource.type !== 'feed')
    return <ResourceFailure error={state.error} />
  const resource = state.resource
  const resourceAddress = resource.address
  const source = resourceAddress.scheme === 'remote'
    ? sourceFromAddress(resourceAddress, 'event-feed')
    : undefined
  const canonical = resourceAddress.scheme === 'remote'
    ? sourceKey(source!)
    : `local:${resourceAddress.spaceId}`
  const subscribed = source && profile.subscriptions?.some((item) => sourceKey(item) === canonical)
  return (
    <section className="resource-detail">
      <div className="resource-heading">
        <div>
          <h1>{pickText(resource.feed.feed.name)}</h1>
          <VisibilityBadge resource={resource} />
        </div>
        <CopyLinkButton url={resourcePath('event-feed', resource.address)} />
      </div>
      {resource.feed.feed.description && <p>{pickText(resource.feed.feed.description)}</p>}
      {!!resource.feed.feed.tags?.length && (
        <div className="my-3.5 flex flex-wrap gap-2 [&_span]:rounded-full [&_span]:bg-panel [&_span]:px-[9px] [&_span]:py-[5px] [&_span]:text-xs [&_span]:text-muted">
          {resource.feed.feed.tags.map((tag) => (
            <span key={tag.id}># {pickText(tag.label) || tag.id}</span>
          ))}
        </div>
      )}
      <button
        className={`subscribe ${subscribed ? 'border border-[#ffffff40] bg-[#ffffff16] text-inherit' : ''}`}
        disabled={!hydrated}
        aria-pressed={Boolean(subscribed)}
        onClick={() => source && act({ type: subscribed ? 'unsubscribe' : 'subscribe', source })}
        hidden={!source}
      >
        {subscribed ? t('messages.subscribed') : t('messages.subscribe_to_channel')}
      </button>
      <h2>{t('messages.events')}</h2>
      <div className="resource-list">
        {(resource.feed.feed.events ?? []).map((event) => (
          <Link className="resource-card" key={event.id} to={eventPath({ id: event.id, address: resource.eventAddresses[event.id] ?? resource.address })}>
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
