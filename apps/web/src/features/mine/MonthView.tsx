import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { expandRecurrence, type ResolvedEvent } from '@ahead/resolver'
import { pickText, describeTemporal, formatCalendarDate } from '../../lib/format'

function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function monthOccurrences(
  events: ResolvedEvent[],
  year: number,
  month: number,
  timezone = 'Asia/Shanghai',
) {
  const days = new Map<string, ResolvedEvent[]>()
  const from = new Date(Date.UTC(year, month, 1) - 86400000)
  const to = new Date(Date.UTC(year, month + 1, 1) + 86400000)
  for (const event of events) {
    const kind = event.currentSchedule?.value.kind
    if (kind !== 'exact' && kind !== 'datetime') continue
    for (const occurrence of expandRecurrence(event, {
      from,
      to,
      max: 10000,
    })) {
      const start = new Date(occurrence.start)
      const end = occurrence.end
        ? new Date(Date.parse(occurrence.end) - 1)
        : start
      const zone = kind === 'exact' ? 'UTC' : timezone
      const first = dayKey(start, zone),
        last = dayKey(end, zone)
      for (
        let day = 1;
        day <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        day++
      ) {
        const key =
          year +
          '-' +
          String(month + 1).padStart(2, '0') +
          '-' +
          String(day).padStart(2, '0')
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

type CalendarScale = 'year' | 'month' | 'week'
const MONTH_HEIGHT = 450
const keyFor = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export function MonthView({
  events,
  timezone,
  search = '',
}: {
  events: ResolvedEvent[]
  timezone: string
  search?: string
}) {
  const { t } = useTranslation()

  const navigate = useNavigate()
  const today = dayKey(new Date(), timezone)
  const params = new URLSearchParams(search)
  const rawDate = params.get('date') ?? today
  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) &&
    Number.isFinite(new Date(rawDate + 'T12:00:00').getTime()) &&
    keyFor(new Date(rawDate + 'T12:00:00')) === rawDate
  const dateKey = validDate ? rawDate : today
  const selected = new Date(dateKey + 'T12:00:00')
  const scale: CalendarScale = ['year', 'week'].includes(
    params.get('scale') ?? '',
  )
    ? (params.get('scale') as CalendarScale)
    : 'month'
  const selectedMonth = selected.getFullYear() * 12 + selected.getMonth()
  const [origin, setOrigin] = useState(selectedMonth - 12)
  const [count, setCount] = useState(25)
  const [navigation, setNavigation] = useState(0)
  const [top, setTop] = useState(12 * MONTH_HEIGHT)
  const viewport = useRef<HTMLDivElement>(null)
  const correction = useRef<number | null>(null)
  const jumpTo = (scrollTop: number) => {
    const element = viewport.current
    if (!element) return
    element.style.scrollSnapType = 'none'
    element.scrollTop = scrollTop
    void element.offsetHeight
    element.style.removeProperty('scroll-snap-type')
  }
  const fromMonth = (index: number) =>
    new Date(Math.floor(index / 12), index % 12, 1)
  const update = (date: string, nextScale = scale) => {
    const next = new URLSearchParams(search)
    next.set('view', 'calendar')
    next.set('scale', nextScale)
    next.set('date', date)
    setNavigation((value) => value + 1)
    navigate('/mine?' + next, { replace: true })
  }
  useLayoutEffect(() => {
    if (scale !== 'month' || !viewport.current) return
    if (selectedMonth < origin || selectedMonth >= origin + count) {
      setOrigin(selectedMonth - 12)
      setCount(25)
      correction.current = 12 * MONTH_HEIGHT
    } else {
      const target = (selectedMonth - origin) * MONTH_HEIGHT
      correction.current = target
      setTop(target)
    }
  }, [dateKey, scale, navigation])
  useEffect(() => {
    if (correction.current !== null && viewport.current) {
      jumpTo(correction.current)
      setTop(correction.current)
      correction.current = null
    }
  }, [origin, count, top, navigation])
  const first = Math.max(0, Math.floor(top / MONTH_HEIGHT) - 1)
  const last = Math.min(count, first + 5)
  const fuzzy = events.filter(
    (event) =>
      !['exact', 'datetime'].includes(
        event.currentSchedule?.value.kind ?? 'unknown',
      ),
  )
  const selectedEvents = useMemo(
    () =>
      monthOccurrences(
        events,
        selected.getFullYear(),
        selected.getMonth(),
        timezone,
      ).get(dateKey) ?? [],
    [events, dateKey, timezone],
  )
  const visibleOccurrences = useMemo(
    () =>
      new Map(
        Array.from({ length: last - first }, (_, i) => {
          const month = fromMonth(origin + first + i)
          return [
            keyFor(month),
            monthOccurrences(
              events,
              month.getFullYear(),
              month.getMonth(),
              timezone,
            ),
          ] as const
        }),
      ),
    [events, first, last, origin, timezone],
  )
  const renderMonth = (month: Date, compact = false) => {
    const year = month.getFullYear(),
      index = month.getMonth()
    const occurrences =
      visibleOccurrences.get(keyFor(month)) ??
      new Map<string, ResolvedEvent[]>()
    return (
      <section
        className={compact ? 'mini-month' : 'calendar-month'}
        key={keyFor(month)}
      >
        <h3>
          {compact ? (
            <button onClick={() => update(keyFor(month), 'month')}>
              {formatCalendarDate(month, { month: 'short' })} </button>
          ) : (
            formatCalendarDate(month, { year: 'numeric', month: 'long' })
          )}
        </h3>
        <div className="month-grid">
          {Array.from({ length: month.getDay() }, (_, i) => (
            <span key={'blank' + i} />
          ))}
          {Array.from(
            { length: new Date(year, index + 1, 0).getDate() },
            (_, i) => {
              const key = keyFor(new Date(year, index, i + 1)),
                list = occurrences.get(key) ?? []
              return (
                <div className="day-cell" key={key}>
                  <button
                    className={
                      (key === dateKey ? 'selected-day ' : '') +
                      (key === today ? 'today' : '')
                    }
                    aria-label={key}
                    aria-pressed={key === dateKey}
                    onClick={() => update(key, 'month')}
                  >
                    {i + 1}
                  </button>
                  {!compact && (
                    <>
                      <div className="day-events">
                        {list.slice(0, 2).map((event) => (
                          <Link
                            key={event.id}
                            to={'/events/' + encodeURIComponent(event.id)}
                          >
                            {pickText(event.title)}
                          </Link>
                        ))}
                      </div>
                      {list.length > 2 && (
                        <span className="event-overflow">
                          +{list.length - 2}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )
            },
          )}
        </div>
      </section>
    )
  }
  const weekStart = new Date(selected)
  weekStart.setDate(selected.getDate() - selected.getDay())
  return (
    <section className="month-view">
      <div className="calendar-controls">
        <div className="view-switch" aria-label={t('messages.calendar_view')}>
          {(['year', 'month', 'week'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={scale === value}
              onClick={() => update(dateKey, value)}
            >
              {{ year: t('messages.year'), month: t('messages.month'), week: t('messages.week') }[value]}
            </button>
          ))}
        </div>
        <button onClick={() => update(today)}>{t('messages.today')}</button>
      </div>
      {scale === 'month' && (
        <>
          <div className="weekdays">
            {Array.from({ length: 7 }, (_, day) => formatCalendarDate(new Date(2024, 0, 7 + day), { weekday: 'short' })).map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div
            className="month-scroll"
            ref={viewport}
            onScroll={(e) => {
              const el = e.currentTarget
              setTop(el.scrollTop)
              if (correction.current !== null) return
              if (el.scrollTop < MONTH_HEIGHT) {
                correction.current = el.scrollTop + 12 * MONTH_HEIGHT
                setOrigin((v) => v - 12)
                setCount((v) => v + 12)
              } else if (
                el.scrollTop + el.clientHeight >
                count * MONTH_HEIGHT - MONTH_HEIGHT
              )
                setCount((v) => v + 12)
            }}
          >
            <div style={{ height: first * MONTH_HEIGHT }} />
            {Array.from({ length: last - first }, (_, i) =>
              renderMonth(fromMonth(origin + first + i)),
            )}
            <div style={{ height: (count - last) * MONTH_HEIGHT }} />
          </div>
        </>
      )}
      {scale === 'year' && (
        <div className="year-scroll">
          <div className="calendar-period">
            <button
              aria-label={t('messages.previous_year')}
              onClick={() =>
                update(keyFor(new Date(selected.getFullYear() - 1, 0, 1)))
              }
            >
              <ChevronLeft />
            </button>
            <h2>{formatCalendarDate(selected, { year: 'numeric' })}</h2>
            <button
              aria-label={t('messages.next_year')}
              onClick={() =>
                update(keyFor(new Date(selected.getFullYear() + 1, 0, 1)))
              }
            >
              <ChevronRight />
            </button>
          </div>
          <div className="year-grid">
            {Array.from({ length: 12 }, (_, i) =>
              renderMonth(new Date(selected.getFullYear(), i, 1), true),
            )}
          </div>
        </div>
      )}
      {scale === 'week' && (
        <div className="week-view">
          <div className="calendar-period">
            <button
              aria-label={t('messages.previous_week')}
              onClick={() => {
                const d = new Date(selected)
                d.setDate(d.getDate() - 7)
                update(keyFor(d))
              }}
            >
              <ChevronLeft />
            </button>
            <h2>
              {formatCalendarDate(selected, { year: 'numeric', month: 'long' })} </h2>
            <button
              aria-label={t('messages.next_week')}
              onClick={() => {
                const d = new Date(selected)
                d.setDate(d.getDate() + 7)
                update(keyFor(d))
              }}
            >
              <ChevronRight />
            </button>
          </div>
          <div className="week-strip">
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(weekStart)
              d.setDate(d.getDate() + i)
              return (
                <button
                  key={i}
                  aria-pressed={keyFor(d) === dateKey}
                  onClick={() => update(keyFor(d))}
                >
                  <small>{Array.from({ length: 7 }, (_, day) => formatCalendarDate(new Date(2024, 0, 7 + day), { weekday: 'short' }))[i]}</small>
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {scale !== 'year' && (
        <div className="day-agenda">
          <h3>
            {formatCalendarDate(selected, { month: 'long', day: 'numeric' })} </h3>
          {selectedEvents.length ? (
            selectedEvents.map((e) => (
              <Link key={e.id} to={'/events/' + encodeURIComponent(e.id)}>
                {pickText(e.title)}
              </Link>
            ))
          ) : (
            <p>{t('messages.nothing_planned')}</p>
          )}
        </div>
      )}
      {!!fuzzy.length && (
        <details className="fuzzy-dates">
          <summary>{t('messages.unscheduled')} {fuzzy.length}</summary>
          {fuzzy.map((e) => (
            <Link key={e.id} to={'/events/' + encodeURIComponent(e.id)}>
              {pickText(e.title)} ·{' '}
              {e.currentSchedule
                ? describeTemporal(e.currentSchedule.value)
                : t('messages.date_tbd')}
            </Link>
          ))}
        </details>
      )}
    </section>
  )
}
