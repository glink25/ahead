import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { sourceKey } from '@ahead/protocol'
import { useFeedStore } from '../../stores/feed'
import { pickText } from '../../lib/format'
import { PERSONAL_FEED } from '../../data/model'
import type { Subscription } from '@ahead/schema'
export function FollowingView() {
  const { t } = useTranslation()
  const priorities = [t('messages.lowest'), t('messages.very_low'), t('messages.low'), t('messages.default'), t('messages.high'), t('messages.very_high'), t('messages.highest')]


  const { profile, feeds, users, listings, act, loading } = useFeedStore()
  const personalFeed = profile.extensions?.[PERSONAL_FEED] as
    Subscription | undefined
  let personalKey: string | undefined
  try {
    if (personalFeed) personalKey = sourceKey(personalFeed)
  } catch {
    /* Invalid external associations are reported by sync. */
  }
  const channels = (profile.subscriptions ?? []).filter(
    (s) => s.kind !== 'user-data' && sourceKey(s) !== personalKey,
  )
  const followed = (profile.subscriptions ?? []).filter(
    (s) => s.kind === 'user-data',
  )
  const available = listings.filter(
    (l) =>
      l.source.resourceType === 'user-data' &&
      !followed.some((s) => sourceKey(s) === sourceKey(l.source)),
  )
  return (
    <section className="following-view">
      <h1>{t('messages.following')}</h1>
      <h2>
         {t('messages.channels')} <small>{channels.length}</small>
      </h2>
      {!channels.length && (
        <p className="muted">
           {t('messages.no_channel_subscriptions_yet')} <Link to="/discover">
             {t('messages.explore')} <ArrowRight />
          </Link>
        </p>
      )}
      {channels.map((source) => {
        const key = sourceKey(source),
          feed = feeds.find((f) => f.sourceLocator === key)
        return (
          <article className="following-card" key={key}>
            <div className="setting-row">
              <h3>{pickText(feed?.feed.name) || t('messages.untitled_channel')}</h3>
              <button onClick={() => act({ type: 'unsubscribe', source })}>
                 {t('messages.unsubscribe')} </button>
            </div>
            <label className="setting-row">
               {t('messages.recommendation_frequency')} <select
                value={source.priority ?? 0}
                onChange={(e) =>
                  act({
                    type: 'priority',
                    source,
                    priority: Number(e.target.value),
                  })
                }
              >
                {priorities.map((label, i) => (
                  <option key={i} value={i - 3}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <details className="technical-details">
              <summary>{t('messages.channel_details')}</summary>
              <p>
                {source.locator} · {source.manifestPath ?? 'ahead.yaml'}
              </p>
            </details>
          </article>
        )
      })}
      <h2>
         {t('messages.people')} <small>{followed.length}</small>
      </h2>
      <p className="muted">{t('messages.recommendations_consider_the_preferences_of_people_you_follow')}</p>
      {followed.map((source) => {
        const key = sourceKey(source),
          user = users.find((u) => u.sourceLocator === key)?.user
        const listing = listings.find((l) => sourceKey(l.source) === key)
        return (
          <article className="following-card" key={key}>
            <div className="setting-row">
              <h3>
                {pickText(user?.displayName) ||
                  pickText(listing?.source.name) ||
                  listing?.title ||
                  t('messages.followed_user')}
              </h3>
              <button onClick={() => act({ type: 'unsubscribe', source })}>
                 {t('messages.unfollow')} </button>
            </div>
            <label className="setting-row">
               {t('messages.recommendation_frequency')} <select
                value={source.priority ?? 0}
                onChange={(e) =>
                  act({
                    type: 'priority',
                    source,
                    priority: Number(e.target.value),
                  })
                }
              >
                {priorities.map((label, i) => (
                  <option key={i} value={i - 3}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <details className="technical-details">
              <summary>{t('messages.user_details')}</summary>
              <p>
                {source.locator} · {source.manifestPath ?? 'ahead.yaml'}
              </p>
            </details>
          </article>
        )
      })}
      {!followed.length && !available.length && (
        <p className="muted">{t('messages.no_people_to_follow_yet')}</p>
      )}
      {available.map((listing) => {
        const source = {
          locator: listing.source.locator,
          manifestPath: listing.source.manifestPath,
          kind: 'user-data' as const,
        }
        return (
          <article
            className="following-card setting-row"
            key={listing.issueNumber}
          >
            <h3>{pickText(listing.source.name) || listing.title}</h3>
            <button
              disabled={loading}
              onClick={() => act({ type: 'subscribe', source })}
            >
               {t('messages.follow')} </button>
          </article>
        )
      })}
    </section>
  )
}
