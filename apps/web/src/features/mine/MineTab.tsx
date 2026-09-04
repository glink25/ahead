import { CalendarDays, List, Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useFeedView } from '../../hooks/useFeedView'
import { countdownFor, pickText } from '../../lib/format'
import { FavoriteButton } from '../discover/PosterCard'
import { MonthView } from './MonthView'
import { posterFor } from '../../lib/media'
import { useFeedStore } from '../../stores/feed'

export function MineTab() {
  const { mine, resolved } = useFeedView()
  const { feeds, profile } = useFeedStore()
  const location = useLocation(),
    navigate = useNavigate()
  const savedSearch = useRef('')
  if (location.pathname === '/mine') savedSearch.current = location.search
  const params = new URLSearchParams(savedSearch.current)
  const calendar = params.get('view') === 'calendar'
  const timeline = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  useEffect(() => {
    if (!calendar && timeline.current)
      timeline.current.scrollTop = scroll.current
  }, [calendar])
  const switchView = () => {
    params.set('view', calendar ? 'timeline' : 'calendar')
    navigate('/mine?' + params, { replace: true })
  }
  let previous = ''
  return (
    <div className="mine-view">
      <div className="mine-toolbar">
        <button
          aria-label={calendar ? '切换时间轴' : '切换日历'}
          onClick={switchView}
        >
          {calendar ? (
            <>
              <List /> 时间轴
            </>
          ) : (
            <>
              <CalendarDays /> 日历
            </>
          )}
        </button>
        <Link to="/following">关注</Link>
      </div>
      {calendar ? (
        <MonthView
          events={mine}
          timezone={resolved.timezone}
          search={savedSearch.current}
        />
      ) : (
        <div
          className="tab-scroll"
          ref={timeline}
          onScroll={(e) => {
            scroll.current = e.currentTarget.scrollTop
          }}
        >
          {!mine.length ? (
            <div className="empty-view">
              <span className="empty-orbit">
                <Plus />
              </span>
              <h2>还没有安排</h2>
              <Link className="primary-link" to="/studio">
                新建事件
              </Link>
              <Link to="/discover">去发现</Link>
            </div>
          ) : (
            <div className="timeline">
              {mine.map((event) => {
                const countdown = countdownFor(event)
                const group = countdown.dateLabel || '日期待定'
                const heading = group !== previous
                previous = group
                const feed = feeds.find((f) =>
                  event.sourceLocators.includes(f.sourceLocator),
                )
                const poster = posterFor(event, {
                  locator: feed?.locator,
                  headSha: feed?.headSha,
                  allowRemoteImages: !profile.settings?.privacyRemoteImages,
                })
                return (
                  <section key={event.id}>
                    {heading && <h2 className="bucket-heading">{group}</h2>}
                    <div className="timeline-row">
                      <Link
                        className="timeline-thumb"
                        to={'/events/' + encodeURIComponent(event.id)}
                        tabIndex={-1}
                        aria-hidden
                        style={{ background: poster.gradient[1] }}
                      >
                        {poster.url && (
                          <img
                            src={poster.url}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.opacity = '0'
                            }}
                          />
                        )}
                      </Link>
                      <Link
                        className="timeline-copy"
                        to={'/events/' + encodeURIComponent(event.id)}
                      >
                        <small>{countdown.headline}</small>
                        <h3>{pickText(event.title)}</h3>
                        <p>
                          {pickText(event.summary) ||
                            pickText(event.description)}
                        </p>
                      </Link>
                      <FavoriteButton event={event} />
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      )}
      <Link className="create-fab" to="/studio" aria-label="新建事件">
        <Plus />
      </Link>
    </div>
  )
}
