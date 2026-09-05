import { sourceKey } from '@ahead/protocol'
import type { Subscription } from '@ahead/schema'
import { mergeEvents, type ResolvedEvent } from '@ahead/resolver'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { PageSkeleton } from '../../app/PageSkeleton'
import { PERSONAL_FEED } from '../../data/model'
import { pickText } from '../../lib/format'
import { loadSharedResource } from '../../services/shared-resource'
import { useAuthSession } from '../../stores'
import { useFeedStore } from '../../stores/feed'
import { CopyLinkButton, ResourceFailure, VisibilityBadge } from './ShareUi'
import { useSharedResource } from './useSharedResource'

export function PersonDetail() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const key = params.get('source')
  const state = useSharedResource(key, 'user-data')
  const { profile, act, ready } = useFeedStore()
  const identity = useAuthSession((value) => value.session?.identity.id)
  const [events, setEvents] = useState<ResolvedEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const user = state.resource?.kind === 'user-data' ? state.resource.user : undefined
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
    void Promise.allSettled(
      channels.slice(0, 40).map((source) =>
        loadSharedResource(sourceKey(source), 'event-feed', controller.signal),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return
      const feeds = results.flatMap((result) =>
        result.status === 'fulfilled' && result.value.kind === 'event-feed'
          ? [result.value.feed]
          : [],
      )
      const personal = user.extensions?.[PERSONAL_FEED] as Subscription | undefined
      let personalKey: string | undefined
      try { if (personal) personalKey = sourceKey(personal) } catch { /* invalid links are omitted */ }
      const visible = new Set([...(user.favorites ?? []), ...(user.pins ?? [])])
      for (const feed of feeds)
        if (feed.sourceLocator === personalKey)
          for (const event of feed.feed.events ?? []) visible.add(event.id)
      setEvents(
        mergeEvents(
          feeds.flatMap((feed) =>
            (feed.feed.events ?? []).map((event) => ({
              event,
              sourceLocator: feed.sourceLocator,
            })),
          ),
        ).filter((event) => visible.has(event.id)),
      )
      setLoadingEvents(false)
    })
    return () => controller.abort()
  }, [user, channels, identity])
  if (state.loading) return <PageSkeleton variant="detail" />
  if (state.error || state.resource?.kind !== 'user-data')
    return <ResourceFailure error={(state.error ?? new Error('Wrong resource type')) as Error & { reason?: string }} />
  const resource = state.resource
  const source = { ...resource.source, kind: 'user-data' as const }
  const canonical = sourceKey(source)
  const followed = profile.subscriptions?.some((item) => sourceKey(item) === canonical)
  return (
    <section className="resource-detail">
      <div className="resource-heading">
        <div>
          <h1>{pickText(resource.user.displayName)}</h1>
          <VisibilityBadge resource={resource} />
        </div>
        <CopyLinkButton url={'/people/view?source=' + encodeURIComponent(canonical)} />
      </div>
      {resource.user.bio && <p>{pickText(resource.user.bio)}</p>}
      <button
        className={'subscribe ' + (followed ? 'subscribed' : '')}
        disabled={!ready}
        aria-pressed={Boolean(followed)}
        onClick={() => act({ type: followed ? 'unsubscribe' : 'subscribe', source })}
      >
        {followed ? t('messages.followed') : t('messages.follow')}
      </button>
      <h2>{t('messages.events')}</h2>
      {loadingEvents && <p className="muted">{t('messages.loading')}</p>}
      <div className="resource-list">
        {events.map((event) => {
          const query = event.sourceLocators.map((value) => 'source=' + encodeURIComponent(value)).join('&')
          return (
            <Link className="resource-card" key={event.id} to={'/events/' + encodeURIComponent(event.id) + '?' + query}>
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
                <Link className="resource-card" key={personKey} to={'/people/view?source=' + encodeURIComponent(personKey)}>
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
            <Link className="resource-card" key={channelKey} to={'/channels/view?source=' + encodeURIComponent(channelKey)}>
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
