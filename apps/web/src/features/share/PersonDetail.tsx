import { sourceKey } from '@ahead/protocol'
import type { Subscription } from '@ahead/schema'
import type { AddressedEvent } from '../../services/market-api'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { PageSkeleton } from '../../app/PageSkeleton'
import { PERSONAL_FEED } from '../../data/model'
import { pickText } from '../../lib/format'
import type { LoadedFeed } from '../../lib/feed-loader'
import { useAuthSession } from '../../stores'
import { useFeedStore } from '../../stores/feed'
import { CopyLinkButton, ResourceFailure, VisibilityBadge } from './ShareUi'
import { useAddressedResource } from './useAddressedResource'
import { marketApi } from '../../services/market'
import {
  addressKey,
  eventPath,
  githubAddress,
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
  const identity = useAuthSession((value) => value.session?.identity.id)
  const verified = useAuthSession((value) => value.verified)
  const [events, setEvents] = useState<AddressedEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const user = state.resource?.type === 'user' ? state.resource.user : undefined
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
  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    setLoadingEvents(true)
    const publish = (feeds: LoadedFeed[]) => {
      if (controller.signal.aborted) return
      const personal = user.extensions?.[PERSONAL_FEED] as Subscription | undefined
      let personalKey: string | undefined
      try { if (personal) personalKey = sourceKey(personal) } catch { /* invalid links are omitted */ }
      const visible = new Set([...(user.favorites ?? []), ...(user.pins ?? [])])
      for (const feed of feeds)
        if (feed.sourceLocator === personalKey)
          for (const event of feed.feed.events ?? []) visible.add(event.id)
      setEvents(marketApi().events.resolve({
        feeds,
        users: [],
        activeProfile: user,
      }).events.filter((event) => visible.has(event.id)))
      setLoadingEvents(false)
    }
    void (async () => {
      const feeds = new Map<string, LoadedFeed>()
      for await (const event of marketApi().sources.read({
        sources: channels.slice(0, 40),
        refresh: true,
        signal: controller.signal,
      })) {
        if (event.type !== 'feed') continue
        feeds.set(event.feed.sourceLocator, event.feed)
        publish([...feeds.values()])
      }
    })().catch(() => setLoadingEvents(false))
    return () => controller.abort()
  }, [user, channels, identity, verified])
  if (state.loading) return <PageSkeleton variant="detail" />
  if (!state.resource || state.resource.type !== 'user')
    return <ResourceFailure error={state.error} />
  const resource = state.resource
  const resourceAddress = resource.address
  const source = resourceAddress.scheme === 'github'
    ? sourceFromAddress(resourceAddress, 'user-data')
    : undefined
  const canonical = resourceAddress.scheme === 'github'
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
                <Link className="resource-card" key={personKey} to={resourcePath('user-data', githubAddress(person))}>
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
            <Link className="resource-card" key={channelKey} to={resourcePath('event-feed', githubAddress(channel))}>
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
