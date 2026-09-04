import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { expandRecurrence, type ResolvedEvent } from '@ahead/resolver'
import { pickText, describeTemporal } from '../../lib/format'

function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function monthOccurrences(events: ResolvedEvent[], year: number, month: number, timezone = 'Asia/Shanghai') {
  const days = new Map<string, ResolvedEvent[]>()
  const from = new Date(Date.UTC(year, month, 1) - 86400000)
  const to = new Date(Date.UTC(year, month + 1, 1) + 86400000)
  for (const event of events) {
    const kind = event.currentSchedule?.value.kind
    if (kind !== 'exact' && kind !== 'datetime') continue
    for (const occurrence of expandRecurrence(event, { from, to, max: 10000 })) {
      const start = new Date(occurrence.start)
      const end = occurrence.end ? new Date(Date.parse(occurrence.end) - 1) : start
      const zone = kind === 'exact' ? 'UTC' : timezone
      const first = dayKey(start, zone), last = dayKey(end, zone)
      for (let day = 1; day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); day++) {
        const key = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0')
        if (key >= first && key <= last) {
          const list = days.get(key) ?? []
          if (!list.some((item) => item.id === event.id)) list.push(event)
          days.set(key, list)
        }
      }
    }
  }
  return days
}

export function MonthView({ events, timezone }: { events: ResolvedEvent[]; timezone: string }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const year = month.getFullYear(), monthIndex = month.getMonth()
  const days = useMemo(() => monthOccurrences(events, year, monthIndex, timezone), [events, year, monthIndex, timezone])
  const count = new Date(year, monthIndex + 1, 0).getDate()
  const fuzzy = events.filter((e) => !['exact', 'datetime'].includes(e.currentSchedule?.value.kind ?? 'unknown'))
  return <section className="month-view"><header><button aria-label="上个月" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}>←</button>
    <h2>{year} 年 {monthIndex + 1} 月</h2><button aria-label="下个月" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}>→</button></header>
    <div className="month-grid">{['日', '一', '二', '三', '四', '五', '六'].map((day) => <span className="weekday" key={day}>{day}</span>)}
      {Array.from({ length: month.getDay() }, (_, i) => <div className="day-cell blank" key={'blank' + i} />)}
      {Array.from({ length: count }, (_, index) => {
        const day = index + 1, key = year + '-' + String(monthIndex + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0')
        return <div key={day} className="day-cell"><time dateTime={key}>{day}</time>{days.get(key)?.map((event) =>
          <Link key={event.id} to={'/events/' + encodeURIComponent(event.id)}>{pickText(event.title)}</Link>)}</div>
      })}
    </div>
    {!!fuzzy.length && <div className="fuzzy-dates"><h3>尚未精确到某一天</h3><p>这些盼头保留原始时间范围，不落到虚构日期上。</p>{fuzzy.map((e) => <Link key={e.id} to={'/events/' + encodeURIComponent(e.id)}>{pickText(e.title)} · {e.currentSchedule ? describeTemporal(e.currentSchedule.value) : '日期待定'}</Link>)}</div>}
  </section>
}
