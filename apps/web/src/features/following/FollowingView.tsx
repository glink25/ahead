import { Link } from 'react-router'
import { sourceKey } from '@ahead/protocol'
import { useFeedStore } from '../../stores/feed'
import { pickText } from '../../lib/format'
export function FollowingView() {
  const { profile, feeds, users, listings, act, loading } = useFeedStore()
  return <section className="following-view"><p className="eyebrow">YOUR SOURCES</p><h1>已订阅的源</h1><p>同一仓库中的不同 manifest 可独立订阅、退订和设置优先级。</p>
    {!profile.subscriptions?.length && <p>还没有订阅。<Link to="/discover">去发现 →</Link></p>}
    {profile.subscriptions?.map((source) => {
      const key = sourceKey(source), feed = feeds.find((f) => f.sourceLocator === key)
      const user = users.find((u) => u.sourceLocator === key)?.user
      return <article className="following-card" key={key}><h2>{pickText(feed?.feed.name ?? user?.displayName) || source.locator}</h2>
        <p>{source.locator} · {source.manifestPath ?? 'ahead.yaml'}</p>
        <label>推荐优先级 <select value={source.priority ?? 0} onChange={(e) => act({ type: 'priority', source, priority: Number(e.target.value) })}>{[-3, -2, -1, 0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <button onClick={() => act({ type: 'unsubscribe', source })}>退订</button>
      </article>
    })}
    <h2>关注公开用户视角</h2><p>公开资料中的喜爱会影响发现推荐，不会自动订阅其事件源或覆盖你的资料。</p>
    {!listings.some((l) => l.source.resourceType === 'user-data') && <p>市场暂时没有公开用户资料。</p>}
    {listings.filter((l) => l.source.resourceType === 'user-data').map((listing) => {
      const source = { locator: listing.source.locator, manifestPath: listing.source.manifestPath, kind: 'user-data' as const }
      const subscribed = profile.subscriptions?.some((s) => sourceKey(s) === sourceKey(source))
      return <article className="following-card" key={listing.issueNumber}><h3>{pickText(listing.source.name) || listing.title}</h3><button disabled={loading} onClick={() => act({ type: subscribed ? 'unsubscribe' : 'subscribe', source })}>{subscribed ? '取消关注' : '关注'}</button></article>
    })}
  </section>
}
