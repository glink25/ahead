import { usePersonEvents } from '../../hooks/usePersonEvents'
import { sourceKey } from '@ahead/protocol'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { PageSkeleton } from '../../app/PageSkeleton'
import { pickText } from '../../lib/format'
import { useFeedStore } from '../../stores/feed'
import { CopyLinkButton, ResourceFailure, VisibilityBadge } from './ShareUi'
import { useAddressedResource } from './useAddressedResource'
import {
  addressKey,
  eventPath,
  remoteAddress,
  parseResourceAddress,
  resourcePath,
  sourceFromAddress,
} from '../../services/resource-address'

export function PersonDetail() {
  const { t } = useTranslation()
  const { '*': sourcePath } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const address = useMemo(() => {
    try { return parseResourceAddress(sourcePath) } catch { return undefined }
  }, [sourcePath])
  const state = useAddressedResource(address, 'user-data')
  const { profile, act, hydrated } = useFeedStore()
  const user = state.resource?.type === 'user' ? state.resource.user : undefined
  const { events, loading: loadingEvents, error: eventsError } = usePersonEvents(user)
  useEffect(() => {
    const next = state.resource?.address
    if (!address || !next || addressKey(address) === addressKey(next)) return
    navigate(resourcePath('user-data', next) + location.search + location.hash, { replace: true })
  }, [address, state.resource, navigate, location.search, location.hash])
  const channels = useMemo(
    () => (user?.subscriptions ?? []).filter((item) => item.kind !== 'user-data'),
    [user],
  )
  const people = useMemo(
    () => (user?.subscriptions ?? []).filter((item) => item.kind === 'user-data'),
    [user],
  )
  if (state.loading) return <PageSkeleton variant="detail" />
  if (!state.resource || state.resource.type !== 'user')
    return <ResourceFailure error={state.error} />
  const resource = state.resource
  const resourceAddress = resource.address
  const source = resourceAddress.scheme === 'remote'
    ? sourceFromAddress(resourceAddress, 'user-data')
    : undefined
  const canonical = resourceAddress.scheme === 'remote'
    ? sourceKey(source!)
    : `local:${resourceAddress.spaceId}`
  const followed = source && profile.subscriptions?.some((item) => sourceKey(item) === canonical)
  return (
    <section className="resource-detail">
      <div className="resource-heading">
        <div>
          <h1>{pickText(resource.user.displayName)}</h1>
          <VisibilityBadge resource={resource} />
        </div>
        <CopyLinkButton url={resourcePath('user-data', resource.address)} />
      </div>
      {eventsError && <p role="status">{t('messages.update_failed_available_content_was_preserved')}</p>}
      {resource.user.bio && <p>{pickText(resource.user.bio)}</p>}
      <button
        className={`subscribe ${followed ? 'border border-[#ffffff40] bg-[#ffffff16] text-inherit' : ''}`}
        disabled={!hydrated}
        aria-pressed={Boolean(followed)}
        onClick={() => source && act({ type: followed ? 'unsubscribe' : 'subscribe', source })}
        hidden={!source}
      >
        {followed ? t('messages.followed') : t('messages.follow')}
      </button>
      <h2>{t('messages.events')}</h2>
      {loadingEvents && <p className="muted">{t('messages.loading')}</p>}
      <div className="resource-list">
        {events.map((event) => {
          return (
            <Link className="resource-card" key={event.id} to={eventPath(event)}>
              <strong>{pickText(event.title)}</strong>
              <small>{pickText(event.summary) || pickText(event.description)}</small>
            </Link>
          )
        })}
      </div>
      {!!people.length && (
        <>
          <h2>{t('messages.people')}</h2>
          <div className="resource-list">
            {people.map((person) => {
              const personKey = sourceKey(person)
              return (
                <Link className="resource-card" key={personKey} to={resourcePath('user-data', remoteAddress(person))}>
                  <strong>{person.locator}</strong>
                  <small>{person.manifestPath ?? 'ahead.yaml'}</small>
                </Link>
              )
            })}
          </div>
        </>
      )}
      <h2>{t('messages.channels')}</h2>
      <div className="resource-list">
        {channels.map((channel) => {
          const channelKey = sourceKey(channel)
          return (
            <Link className="resource-card" key={channelKey} to={resourcePath('event-feed', remoteAddress(channel))}>
              <strong>{channel.locator}</strong>
              <small>{channel.manifestPath ?? 'ahead.yaml'}</small>
            </Link>
          )
        })}
      </div>
      <details className="technical-details">
        <summary>{t('messages.user_details')}</summary>
        <p>{canonical}</p>
      </details>
    </section>
  )
}
