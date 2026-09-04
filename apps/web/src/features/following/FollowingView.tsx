import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { sourceKey } from '@ahead/protocol'
import { useFeedStore } from '../../stores/feed'
import { pickText } from '../../lib/format'
import { PERSONAL_FEED } from '../../data/model'
import type { Subscription } from '@ahead/schema'
const priorities = ['最低', '很低', '较低', '默认', '较高', '很高', '最高']
export function FollowingView() {
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
      <h1>关注</h1>
      <h2>
        频道 <small>{channels.length}</small>
      </h2>
      {!channels.length && (
        <p className="muted">
          还没有订阅频道。
          <Link to="/discover">
            去发现 <ArrowRight />
          </Link>
        </p>
      )}
      {channels.map((source) => {
        const key = sourceKey(source),
          feed = feeds.find((f) => f.sourceLocator === key)
        return (
          <article className="following-card" key={key}>
            <div className="setting-row">
              <h3>{pickText(feed?.feed.name) || '未命名频道'}</h3>
              <button onClick={() => act({ type: 'unsubscribe', source })}>
                取消订阅
              </button>
            </div>
            <label className="setting-row">
              推荐频率
              <select
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
              <summary>频道详情</summary>
              <p>
                {source.locator} · {source.manifestPath ?? 'ahead.yaml'}
              </p>
            </details>
          </article>
        )
      })}
      <h2>
        用户 <small>{followed.length}</small>
      </h2>
      <p className="muted">关注后，推荐会参考对方的喜好。</p>
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
                  '已关注用户'}
              </h3>
              <button onClick={() => act({ type: 'unsubscribe', source })}>
                取消关注
              </button>
            </div>
            <label className="setting-row">
              推荐频率
              <select
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
              <summary>用户详情</summary>
              <p>
                {source.locator} · {source.manifestPath ?? 'ahead.yaml'}
              </p>
            </details>
          </article>
        )
      })}
      {!followed.length && !available.length && (
        <p className="muted">暂时没有可关注的用户</p>
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
              关注
            </button>
          </article>
        )
      })}
    </section>
  )
}
