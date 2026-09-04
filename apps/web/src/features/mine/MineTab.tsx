import { Link, useSearchParams } from 'react-router'
import { assignBucket, daysUntilEvent } from '@ahead/recommendation'
import { useFeedView } from '../../hooks/useFeedView'
import { BUCKET_LABELS, countdownFor, pickText } from '../../lib/format'
import { FavoriteButton } from '../discover/PosterCard'
import { MonthView } from './MonthView'
import { posterFor } from '../../lib/media'
import { useFeedStore } from '../../stores/feed'

export function MineTab() {
  const { mine, resolved } = useFeedView()
  const { feeds, profile } = useFeedStore()
  const [params] = useSearchParams()
  if (!mine.length) return <div className="empty-view"><span className="empty-orbit">♡</span><p className="eyebrow">YOUR NEXT CHAPTER</p><h1>给未来，留一点期待。</h1><p>订阅一个源，或喜爱一个事件。<br />值得等的日子，就会来到这里。</p><Link className="primary-link" to="/discover">去发现盼头 ↗</Link></div>
  if (params.get('view') === 'calendar') return <div className="tab-scroll"><MonthView events={mine} timezone={resolved.timezone} /></div>
  let previous = ''
  return <div className="tab-scroll"><div className="timeline"><header><p className="eyebrow">YOUR HORIZON</p><h1>我的盼头<span>{mine.length}</span></h1><p>把值得期待的日子，放在眼前。</p></header>
    {mine.map((event) => {
      const bucket = assignBucket(daysUntilEvent(event, new Date()))
      const heading = bucket !== previous
      previous = bucket
      const countdown = countdownFor(event)
      const feed = feeds.find((f) => event.sourceLocators.includes(f.sourceLocator))
      const poster = posterFor(event, { locator: feed?.locator, headSha: feed?.headSha, allowRemoteImages: !profile.settings?.privacyRemoteImages })
      return <section key={event.id}>{heading && <h2 className="bucket-heading">{BUCKET_LABELS[bucket]}</h2>}
        <div className="timeline-row"><div className="timeline-thumb" style={{ background: poster.gradient[1] }}>{poster.url && <img src={poster.url} alt={poster.alt} loading="lazy" />}</div>
          <Link to={'/events/' + encodeURIComponent(event.id)}><small>{countdown.headline}</small><h3>{pickText(event.title)}</h3><p>{countdown.dateLabel}</p><div className="tag-list">{event.tags?.map((t) => <span key={t}>#{t}</span>)}</div></Link><FavoriteButton event={event} /></div>
      </section>
    })}
  </div></div>
}
