import { useParams } from 'react-router'
import { useFeedView } from '../../hooks/useFeedView'
import { useFeedStore } from '../../stores/feed'
import { countdownFor, pickText, describeTemporal, CONFIDENCE_LABELS } from '../../lib/format'
import { EvidenceLinks, FavoriteButton, FeedSourceBar, HideMenu } from '../discover/PosterCard'
export function EventDetail() {
  const { id } = useParams()
  const { resolved } = useFeedView()
  const loading = useFeedStore((s) => s.loading)
  const event = resolved.events.find((e) => e.id === id)
  if (!event) return <div className="empty-view">{loading ? '正在加载事件…' : '没有找到这个事件，源可能已下架或暂时不可用。'}</div>
  const countdown = countdownFor(event)
  return <article className="event-detail"><p className="eyebrow">THE STORY OF A DATE</p><h1>{pickText(event.title)}</h1><p className="detail-countdown">{countdown.headline}</p>
    <p>{pickText(event.description) || pickText(event.summary)}</p><div className="detail-actions"><FavoriteButton event={event} /><HideMenu event={event} /></div>
    <h2>日期如何逐渐确定</h2><ol className="schedule-timeline">{[...event.schedule].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).map((entry) => <li key={entry.id}>
      <time>{new Date(entry.recordedAt).toLocaleDateString('zh-CN')}</time><h3>{describeTemporal(entry.value)}</h3><p>{entry.confidence && CONFIDENCE_LABELS[entry.confidence]}{entry.source && ' · ' + entry.source}</p><EvidenceLinks evidence={entry.evidence} />
    </li>)}</ol>
    <h2>信息来源</h2><EvidenceLinks evidence={event.evidence} />
    {event.evidence?.filter((e) => e.kind === 'citation' || e.kind === 'note').map((e, i) => <p className="citation" key={i}>{e.value}</p>)}
    <FeedSourceBar event={event} />
  </article>
}
