import { useData, deleteEvent } from '../../data/local'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useFeedView } from '../../hooks/useFeedView'
import { useFeedStore } from '../../stores/feed'
import {
  countdownFor,
  pickText,
  describeTemporal,
  CONFIDENCE_LABELS,
} from '../../lib/format'
import {
  EvidenceLinks,
  FavoriteButton,
  FeedSourceBar,
  HideMenu,
} from '../discover/PosterCard'
export function EventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { db } = useData()
  const [error, setError] = useState('')
  const { resolved } = useFeedView()
  const loading = useFeedStore((s) => s.loading)
  const event = resolved.events.find((e) => e.id === id)
  if (!event)
    return (
      <div className="empty-view">
        {loading
          ? '正在加载事件…'
          : '没有找到这个事件，内容可能已下架或暂时不可用。'}
      </div>
    )
  const own = event.sourceLocators.some((s) => s === 'personal:' + db?.active)
  const countdown = countdownFor(event)
  return (
    <article className="event-detail">
      <h1>{pickText(event.title)}</h1>
      <p className="detail-countdown">{countdown.headline}</p>
      <p>{pickText(event.description) || pickText(event.summary)}</p>
      {own && <div className="personal-actions"><Link className="primary-link" to={'/studio?event=' + encodeURIComponent(event.id)}>编辑</Link><button onClick={() => { if (db) void deleteEvent(db.active, event.id).then(() => navigate('/mine')).catch(() => setError('删除未能保存，请重试')) }}>删除</button><Link to="/history">历史与恢复</Link></div>}
      {error && <p role="alert">{error}</p>}
      <div className="detail-actions">
        <FavoriteButton event={event} />
        <HideMenu event={event} />
      </div>
      <h2>日期记录</h2>
      <ol className="schedule-timeline">
        {[...event.schedule]
          .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
          .map((entry) => (
            <li key={entry.id}>
              <time>
                {new Date(entry.recordedAt).toLocaleDateString('zh-CN')}
              </time>
              <h3>{describeTemporal(entry.value)}</h3>
              <p>
                {entry.confidence && CONFIDENCE_LABELS[entry.confidence]}
                {entry.source && ' · ' + entry.source}
              </p>
              <EvidenceLinks evidence={entry.evidence} />
            </li>
          ))}
      </ol>
      <h2>信息来源</h2>
      <EvidenceLinks evidence={event.evidence} />
      {event.evidence
        ?.filter((e) => e.kind === 'citation' || e.kind === 'note')
        .map((e, i) => (
          <p className="citation" key={i}>
            {e.value}
          </p>
        ))}
      <FeedSourceBar event={event} />
    </article>
  )
}
