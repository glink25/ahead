import { useTranslation } from 'react-i18next'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, useNavigate } from 'react-router'
import { expandRecurrence, type ResolvedEvent } from '@ahead/resolver'
import type { TemporalValue } from '@ahead/schema'
import { pickText, describeTemporal, formatCalendarDate } from '../../lib/format'

const DAY = 86400000
const WINDOW_RADIUS = 3
type CalendarScale = 'year' | 'month' | 'week'

function parseKey(value: string) {
  return new Date(value + 'T00:00:00.000Z')
}
const keyFor = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
function addDays(date: Date, amount: number) {
  return new Date(date.getTime() + amount * DAY)
}
function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
function calendarLabel(date: Date, options: Intl.DateTimeFormatOptions, locale?: string) {
  return formatCalendarDate(date, { ...options, timeZone: 'UTC' }, locale)
}
export function firstDayOfWeek(locale: string) {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      weekInfo?: { firstDay: number }
      getWeekInfo?: () => { firstDay: number }
    }
    const day = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay
    if (day) return day === 7 ? 0 : day
  } catch {
    // Older browsers use the stable fallback below.
  }
  return /^en-US\b/i.test(locale) ? 0 : 1
}
function startOfWeek(date: Date, firstDay: number) {
  return addDays(date, -((date.getUTCDay() - firstDay + 7) % 7))
}

function monthKeyBounds(value: TemporalValue, timezone: string): [number, number] | undefined {
  if (value.kind === 'unknown') return undefined
  if (value.kind === 'exact') {
    const date = parseKey(value.date)
    const month = date.getUTCFullYear() * 12 + date.getUTCMonth()
    return [month, month]
  }
  if (value.kind === 'datetime') {
    const date = parseKey(dayKey(new Date(value.dateTime), timezone))
    const month = date.getUTCFullYear() * 12 + date.getUTCMonth()
    return [month, month]
  }
  if (value.kind === 'month') {
    const month = value.year * 12 + value.month - 1
    return [month, month]
  }
  if (value.kind === 'quarter') {
    const first = value.year * 12 + (value.quarter - 1) * 3
    return [first, first + 2]
  }
  if (value.kind === 'year') return [value.year * 12, value.year * 12 + 11]
  const start = monthKeyBounds(value.start, timezone)
  const end = monthKeyBounds(value.end, timezone)
  if (!start || !end) return undefined
  return [Math.min(start[0], end[0]), Math.max(start[1], end[1])]
}
function preciseRangeKeys(value: TemporalValue, timezone: string) {
  if (value.kind !== 'range') return undefined
  const key = (part: TemporalValue) => {
    if (part.kind === 'exact') return part.date
    if (part.kind === 'datetime') return dayKey(new Date(part.dateTime), timezone)
    return undefined
  }
  const start = key(value.start)
  const end = key(value.end)
  return start && end
    ? ([start < end ? start : end, start < end ? end : start] as const)
    : undefined
}

export function monthOccurrences(
  events: ResolvedEvent[],
  year: number,
  month: number,
  timezone = 'Asia/Shanghai',
) {
  const days = new Map<string, ResolvedEvent[]>()
  const from = new Date(Date.UTC(year, month, 1) - DAY)
  const to = new Date(Date.UTC(year, month + 1, 1) + DAY)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const add = (key: string, event: ResolvedEvent) => {
    const list = days.get(key) ?? []
    if (!list.some((item) => item.id === event.id)) list.push(event)
    days.set(key, list)
  }
  for (const event of events) {
    const value = event.currentSchedule?.value
    if (!value) continue
    const range = !event.recurrence ? preciseRangeKeys(value, timezone) : undefined
    if (range) {
      for (let day = 1; day <= lastDay; day += 1) {
        const key = keyFor(new Date(Date.UTC(year, month, day)))
        if (key >= range[0] && key <= range[1]) add(key, event)
      }
      continue
    }
    if (value.kind !== 'exact' && value.kind !== 'datetime') continue
    for (const occurrence of expandRecurrence(event, { from, to, max: 10000 })) {
      const start = new Date(occurrence.start)
      const end = occurrence.end ? new Date(Date.parse(occurrence.end) - 1) : start
      const zone = value.kind === 'exact' ? 'UTC' : timezone
      const first = dayKey(start, zone)
      const last = dayKey(end, zone)
      for (let day = 1; day <= lastDay; day += 1) {
        const key = keyFor(new Date(Date.UTC(year, month, day)))
        if (key >= first && key <= last) add(key, event)
      }
    }
  }
  return days
}

function eventsForDays(events: ResolvedEvent[], days: Date[], timezone: string) {
  const months = new Map<string, Map<string, ResolvedEvent[]>>()
  for (const date of days) {
    const month = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    if (!months.has(month)) {
      months.set(month, monthOccurrences(events, date.getUTCFullYear(), date.getUTCMonth(), timezone))
    }
  }
  return new Map(days.map((date) => {
    const month = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    return [keyFor(date), months.get(month)?.get(keyFor(date)) ?? []] as const
  }))
}
function periodOrdinal(scale: CalendarScale, date: Date, firstDay: number) {
  if (scale === 'year') return date.getUTCFullYear()
  if (scale === 'month') return date.getUTCFullYear() * 12 + date.getUTCMonth()
  const epoch = startOfWeek(new Date(Date.UTC(1970, 0, 1)), firstDay)
  return Math.round((startOfWeek(date, firstDay).getTime() - epoch.getTime()) / (7 * DAY))
}
function periodFromOrdinal(scale: CalendarScale, ordinal: number, firstDay: number) {
  if (scale === 'year') return new Date(Date.UTC(ordinal, 0, 1))
  if (scale === 'month') return new Date(Date.UTC(Math.floor(ordinal / 12), ordinal % 12, 1))
  const epoch = startOfWeek(new Date(Date.UTC(1970, 0, 1)), firstDay)
  return addDays(epoch, ordinal * 7)
}
function eventTime(event: ResolvedEvent, timezone: string, locale: string) {
  const value = event.currentSchedule?.value
  if (value?.kind !== 'datetime') return ''
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value.dateTime))
}
function approximateEvents(
  events: ResolvedEvent[],
  fromMonth: number,
  toMonth: number,
  timezone: string,
  monthOnly = false,
) {
  return events.filter((event) => {
    const value = event.currentSchedule?.value
    if (!value || value.kind === 'unknown' || value.kind === 'exact' || value.kind === 'datetime') return false
    if (preciseRangeKeys(value, timezone)) return false
    if (monthOnly && value.kind !== 'month' && value.kind !== 'range') return false
    const bounds = monthKeyBounds(value, timezone)
    return !!bounds && bounds[0] <= toMonth && bounds[1] >= fromMonth
  })
}

function PeriodScroller({
  scale,
  dateKey,
  firstDay,
  jumpToken,
  onPeriodChange,
  renderPeriod,
}: {
  scale: CalendarScale
  dateKey: string
  firstDay: number
  jumpToken: number
  onPeriodChange: (date: Date) => void
  renderPeriod: (date: Date) => ReactNode
}) {
  const target = periodOrdinal(scale, parseKey(dateKey), firstDay)
  const [base, setBase] = useState(target - WINDOW_RADIUS)
  const viewport = useRef<HTMLDivElement>(null)
  const active = useRef(target)
  const initialized = useRef(false)
  const lastJump = useRef(jumpToken)
  const correction = useRef<{ ordinal: number; top: number } | undefined>(undefined)
  const programmaticTarget = useRef<number | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    if (correction.current) {
      const item = element.querySelector<HTMLElement>(`[data-period-ordinal="${correction.current.ordinal}"]`)
      if (item) element.scrollTop += item.getBoundingClientRect().top - correction.current.top
      correction.current = undefined
      return
    }
    if (target < base || target > base + WINDOW_RADIUS * 2) {
      setBase(target - WINDOW_RADIUS)
      return
    }
    const shouldMove = !initialized.current || target !== active.current || jumpToken !== lastJump.current
    if (!shouldMove) return
    const item = element.querySelector<HTMLElement>(`[data-period-ordinal="${target}"]`)
    if (!item) return
    const smooth = initialized.current && jumpToken !== lastJump.current
    if (initialized.current) programmaticTarget.current = target
    element.scrollTo({ top: item.offsetTop, behavior: smooth ? 'smooth' : 'auto' })
    active.current = target
    initialized.current = true
    lastJump.current = jumpToken
  }, [base, jumpToken, target])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const settle = () => {
    const element = viewport.current
    if (!element) return
    const top = element.getBoundingClientRect().top
    const items = [...element.querySelectorAll<HTMLElement>('[data-period-ordinal]')]
    if (!items.length) return
    const current = items.reduce((closest, item) =>
      Math.abs(item.getBoundingClientRect().top - top) < Math.abs(closest.getBoundingClientRect().top - top)
        ? item
        : closest,
    )
    const ordinal = Number(current.dataset.periodOrdinal)
    active.current = ordinal
    if (programmaticTarget.current !== undefined) {
      if (ordinal === programmaticTarget.current) programmaticTarget.current = undefined
      return
    }
    onPeriodChange(periodFromOrdinal(scale, ordinal, firstDay))
    if (ordinal <= base + 2 || ordinal >= base + WINDOW_RADIUS * 2 - 2) {
      correction.current = { ordinal, top: current.getBoundingClientRect().top }
      setBase(ordinal - WINDOW_RADIUS)
    }
  }

  return (
    <div
      className={`calendar-scroll ${scale}-scroll`}
      ref={viewport}
      onScroll={() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(settle, 100)
      }}
    >
      {Array.from({ length: WINDOW_RADIUS * 2 + 1 }, (_, index) => {
        const ordinal = base + index
        return (
          <section
            className={`calendar-group ${scale}-group`}
            data-period-ordinal={ordinal}
            data-active={ordinal === target ? 'true' : undefined}
            key={ordinal}
          >
            {renderPeriod(periodFromOrdinal(scale, ordinal, firstDay))}
          </section>
        )
      })}
    </div>
  )
}

type PeriodProps = {
  events: ResolvedEvent[]
  timezone: string
  locale: string
  dateKey: string
  today: string
  onSelect: (key: string, scale?: CalendarScale) => void
}

function MonthPeriod({
  month,
  events,
  timezone,
  locale,
  firstDay,
  dateKey,
  today,
  onSelect,
}: PeriodProps & { month: Date; firstDay: number }) {
  const year = month.getUTCFullYear()
  const index = month.getUTCMonth()
  const occurrences = useMemo(
    () => monthOccurrences(events, year, index, timezone),
    [events, index, timezone, year],
  )
  const approximate = useMemo(
    () => approximateEvents(events, year * 12 + index, year * 12 + index, timezone, true),
    [events, index, timezone, year],
  )
  const blanks = (month.getUTCDay() - firstDay + 7) % 7
  const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate()
  return (
    <>
      <h2>{calendarLabel(month, { year: 'numeric', month: 'long' }, locale)}</h2>
      {!!approximate.length && (
        <div className="approximate-events">
          {approximate.map((event) => (
            <Link key={event.id} to={'/events/' + encodeURIComponent(event.id)}>
              {pickText(event.title)} · {describeTemporal(event.currentSchedule!.value)}
            </Link>
          ))}
        </div>
      )}
      <div className="month-grid">
        {Array.from({ length: blanks }, (_, i) => <span key={'blank' + i} />)}
        {Array.from({ length: count }, (_, i) => {
          const key = keyFor(new Date(Date.UTC(year, index, i + 1)))
          const list = occurrences.get(key) ?? []
          return (
            <div className="day-cell" key={key}>
              <button
                className={`${key === dateKey ? 'selected-day ' : ''}${key === today ? 'today' : ''}`}
                aria-label={key}
                aria-pressed={key === dateKey}
                onClick={() => onSelect(key)}
              >
                {i + 1}
              </button>
              <div className="day-events">
                {list.slice(0, 2).map((event) => (
                  <Link key={event.id} to={'/events/' + encodeURIComponent(event.id)}>
                    {pickText(event.title)}
                  </Link>
                ))}
              </div>
              {list.length > 2 && <span className="event-overflow">+{list.length - 2}</span>}
            </div>
          )
        })}
      </div>
    </>
  )
}

function YearPeriod({
  yearDate,
  events,
  timezone,
  locale,
  firstDay,
  dateKey,
  today,
  onSelect,
}: PeriodProps & { yearDate: Date; firstDay: number }) {
  const year = yearDate.getUTCFullYear()
  const approximate = useMemo(
    () => approximateEvents(events, year * 12, year * 12 + 11, timezone),
    [events, timezone, year],
  )
  const occurrences = useMemo(
    () => Array.from({ length: 12 }, (_, month) => monthOccurrences(events, year, month, timezone)),
    [events, timezone, year],
  )
  return (
    <>
      <h2>{calendarLabel(yearDate, { year: 'numeric' }, locale)}</h2>
      {!!approximate.length && (
        <div className="approximate-events year-approximate-events">
          {approximate.map((event) => (
            <Link key={event.id} to={'/events/' + encodeURIComponent(event.id)}>
              {pickText(event.title)} · {describeTemporal(event.currentSchedule!.value)}
            </Link>
          ))}
        </div>
      )}
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, monthIndex) => {
          const month = new Date(Date.UTC(year, monthIndex, 1))
          const blanks = (month.getUTCDay() - firstDay + 7) % 7
          const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
          return (
            <section className="mini-month" key={monthIndex}>
              <h3>
                <button onClick={() => onSelect(keyFor(month), 'month')}>
                  {calendarLabel(month, { month: 'short' }, locale)}
                </button>
              </h3>
              <div className="month-grid">
                {Array.from({ length: blanks }, (_, i) => <span key={'blank' + i} />)}
                {Array.from({ length: count }, (_, i) => {
                  const key = keyFor(new Date(Date.UTC(year, monthIndex, i + 1)))
                  const list = occurrences[monthIndex]!.get(key) ?? []
                  return (
                    <div className="day-cell" key={key}>
                      <button
                        className={`${key === dateKey ? 'selected-day ' : ''}${key === today ? 'today' : ''}`}
                        aria-label={key}
                        aria-pressed={key === dateKey}
                        onClick={() => onSelect(key, 'month')}
                      >
                        {i + 1}
                      </button>
                      {!!list.length && (
                        <span
                          className="event-dots"
                          role="img"
                          aria-label={list.map((event) => pickText(event.title)).join(', ')}
                        >
                          {list.slice(0, 3).map((event) => <i key={event.id} aria-hidden />)}
                          {list.length > 3 && <small aria-hidden>+{list.length - 3}</small>}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

function WeekPeriod({
  week,
  events,
  timezone,
  locale,
  dateKey,
  today,
  onSelect,
}: PeriodProps & { week: Date }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const occurrences = useMemo(() => eventsForDays(events, days, timezone), [days, events, timezone])
  const end = days[6]!
  return (
    <>
      <h2>
        {calendarLabel(week, { month: 'short', day: 'numeric' }, locale)} –{' '}
        {calendarLabel(end, { year: 'numeric', month: 'short', day: 'numeric' }, locale)}
      </h2>
      <div className="week-agenda">
        {days.map((day) => {
          const key = keyFor(day)
          const list = occurrences.get(key) ?? []
          return (
            <section className={`week-day-row${key === today ? ' today' : ''}`} key={key}>
              <button
                className={key === dateKey ? 'selected-day' : ''}
                aria-label={key}
                aria-pressed={key === dateKey}
                onClick={() => onSelect(key)}
              >
                <small>{calendarLabel(day, { weekday: 'short' }, locale)}</small>
                <strong>{day.getUTCDate()}</strong>
              </button>
              <div className="week-day-events">
                {list.length ? list.map((event) => {
                  const time = eventTime(event, timezone, locale)
                  const summary = pickText(event.summary) || pickText(event.description)
                  return (
                    <Link className="week-event" key={event.id} to={'/events/' + encodeURIComponent(event.id)}>
                      {time && <small>{time}</small>}
                      <strong>{pickText(event.title)}</strong>
                      {summary && <span>{summary}</span>}
                    </Link>
                  )
                }) : <span className="week-empty">—</span>}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

export function MonthView({
  events,
  timezone,
  search = '',
}: {
  events: ResolvedEvent[]
  timezone: string
  search?: string
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const today = dayKey(new Date(), timezone)
  const params = new URLSearchParams(search)
  const rawDate = params.get('date') ?? today
  const parsed = parseKey(rawDate)
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) &&
    Number.isFinite(parsed.getTime()) && keyFor(parsed) === rawDate ? rawDate : today
  const scale: CalendarScale = ['year', 'week'].includes(params.get('scale') ?? '')
    ? (params.get('scale') as CalendarScale)
    : 'month'
  const locale = i18n.resolvedLanguage ?? i18n.language
  const firstDay = firstDayOfWeek(locale)
  const [jumpToken, setJumpToken] = useState(0)

  const update = (date: string, nextScale = scale, forceJump = false) => {
    const next = new URLSearchParams(search)
    next.set('view', 'calendar')
    next.set('scale', nextScale)
    next.set('date', date)
    if (forceJump) setJumpToken((value) => value + 1)
    navigate('/mine?' + next, { replace: true })
  }
  const onPeriodChange = (start: Date) => {
    const selected = parseKey(dateKey)
    const samePeriod = periodOrdinal(scale, selected, firstDay) === periodOrdinal(scale, start, firstDay)
    const nextDate = samePeriod ? dateKey : keyFor(start)
    if (nextDate !== dateKey) update(nextDate)
  }
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const sunday = new Date(Date.UTC(2024, 0, 7))
    return calendarLabel(addDays(sunday, (firstDay + index) % 7), { weekday: 'short' }, locale)
  })
  const unknown = events.filter((event) =>
    event.currentSchedule?.value.kind === 'unknown' || !event.currentSchedule,
  )

  return (
    <section className="month-view">
      <div className="calendar-controls">
        <div className="view-switch" aria-label={t('messages.calendar_view')}>
          {(['year', 'month', 'week'] as const).map((value) => (
            <button key={value} aria-pressed={scale === value} onClick={() => update(dateKey, value)}>
              {{ year: t('messages.year'), month: t('messages.month'), week: t('messages.week') }[value]}
            </button>
          ))}
        </div>
        <button onClick={() => update(today, scale, true)}>{t('messages.today')}</button>
      </div>
      {scale === 'month' && (
        <div className="weekdays">
          {weekdays.map((day) => <span key={day}>{day}</span>)}
        </div>
      )}
      <PeriodScroller
        key={`${scale}-${firstDay}`}
        scale={scale}
        dateKey={dateKey}
        firstDay={firstDay}
        jumpToken={jumpToken}
        onPeriodChange={onPeriodChange}
        renderPeriod={(period) => scale === 'year' ? (
          <YearPeriod
            yearDate={period} events={events} timezone={timezone} locale={locale}
            firstDay={firstDay} dateKey={dateKey} today={today} onSelect={update}
          />
        ) : scale === 'month' ? (
          <MonthPeriod
            month={period} events={events} timezone={timezone} locale={locale}
            firstDay={firstDay} dateKey={dateKey} today={today} onSelect={update}
          />
        ) : (
          <WeekPeriod
            week={period} events={events} timezone={timezone} locale={locale}
            dateKey={dateKey} today={today} onSelect={update}
          />
        )}
      />
      {!!unknown.length && (
        <details className="fuzzy-dates">
          <summary>{t('messages.unscheduled')} {unknown.length}</summary>
          {unknown.map((event) => (
            <Link key={event.id} to={'/events/' + encodeURIComponent(event.id)}>
              {pickText(event.title)} ·{' '}
              {event.currentSchedule ? describeTemporal(event.currentSchedule.value) : t('messages.date_tbd')}
            </Link>
          ))}
        </details>
      )}
    </section>
  )
}
