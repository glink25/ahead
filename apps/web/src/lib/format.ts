import { i18n, currentLanguage } from '../i18n'
import { daysUntilEvent, isEventOngoing, eventInterval, type RecommendationBucket } from '@ahead/recommendation'
import { selectCurrentSchedule, type ResolvedEvent } from '@ahead/resolver'
import type { LocalizedText, ScheduleConfidence, TemporalValue } from '@ahead/schema'

/**
 * How much the underlying schedule actually pins down.
 *
 * The UI keys typography off this so an estimate never looks as certain as a
 * confirmed date (manual section 28: never fake precision).
 */
export type Precision = 'exact' | 'approximate' | 'unknown'

export interface Countdown {
  /** Primary line, e.g. 还有 37 天 / 预计 Q4 2027 / 日期待定. */
  headline: string
  /** Secondary line describing the date itself, empty when unknown. */
  dateLabel: string
  precision: Precision
  daysUntil: number | null
  ongoing: boolean
  past: boolean
}

export const BUCKET_LABELS: Record<RecommendationBucket, string> = {
  '0-7d': 'messages.within_a_week',
  '7-30d': 'messages.this_month',
  '1-3m': 'messages.within_three_months',
  '3-12m': 'messages.this_year',
  '1y+': 'messages.further_ahead',
  unknown: 'messages.date_tbd',
}

export const CONFIDENCE_LABELS: Record<ScheduleConfidence, string> = {
  confirmed: 'messages.confirmed',
  likely: 'messages.likely',
  rumored: 'messages.rumored',
  cancelled: 'messages.cancelled',
}

export function pickLocalizedText(text: LocalizedText | undefined, locale: string = currentLanguage()): { text: string; language: string } {
  const entries = Object.entries(text ?? {})
  const requested = locale.toLowerCase()
  const match = entries.find(([key]) => key.toLowerCase() === requested)
    ?? entries.find(([key]) => key.toLowerCase().split('-')[0] === requested.split('-')[0])
    ?? entries[0]
  return match ? { language: match[0], text: match[1] } : { language: locale, text: '' }
}

export function pickText(text: LocalizedText | undefined, locale: string = currentLanguage()): string {
  return pickLocalizedText(text, locale).text
}

export function formatCalendarDate(date: Date, options: Intl.DateTimeFormatOptions, locale: string = currentLanguage()): string {
  return new Intl.DateTimeFormat(locale, options).format(date)
}

function formatDay(iso: string, locale: string): string {
  const date = new Date(iso + 'T12:00:00Z')
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date)
}

/** Human description of a temporal value, without any countdown. */
export function describeTemporal(value: TemporalValue, locale: string = currentLanguage()): string {
  switch (value.kind) {
    case 'exact':
      return formatDay(value.date, locale)
    case 'datetime': {
      const date = new Date(value.dateTime)
      if (!Number.isFinite(date.getTime())) return value.dateTime
      let timezone = value.timezone
      try { if (timezone) new Intl.DateTimeFormat(locale, { timeZone: timezone }) } catch { timezone = 'UTC' }
      const formatter = new Intl.DateTimeFormat(locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        ...(timezone ? { timeZone: timezone } : {}),
      })
      return formatter.format(date)
    }
    case 'month':
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(value.year, value.month - 1, 1)))
    case 'quarter':
      return i18n.t('dates.quarter', { lng: locale, year: String(value.year), quarter: i18n.t('dates.quarters.' + value.quarter, { lng: locale }) })
    case 'year':
      return i18n.t('dates.year', { lng: locale, year: String(value.year) })
    case 'range':
      return `${describeTemporal(value.start, locale)} — ${describeTemporal(value.end, locale)}`
    case 'unknown':
      return pickText(value.note, locale) || i18n.t('messages.date_tbd', { lng: locale })
  }
}

export function precisionOf(value: TemporalValue): Precision {
  switch (value.kind) {
    case 'exact':
    case 'datetime':
      return 'exact'
    case 'month':
    case 'quarter':
    case 'year':
    case 'range':
      return 'approximate'
    case 'unknown':
      return 'unknown'
  }
}

function approximateHeadline(value: TemporalValue, days: number, locale: string): string {
  const t = i18n.getFixedT(locale)
  if (days < 0) return t('dates.past', { date: describeTemporal(value, locale) })
  if (value.kind === 'month') return t('dates.monthsAway', { count: Math.max(1, Math.round(days / 30)) })
  return t('dates.expected', { date: describeTemporal(value, locale) })
}

function exactHeadline(days: number, locale: string): string {
  const t = i18n.getFixedT(locale)
  const whole = Math.ceil(days)
  if (whole < 0) return t('dates.daysAgo', { count: Math.abs(Math.floor(days)) })
  if (whole === 0) return t('messages.today_2')
  if (whole === 1) return t('messages.tomorrow')
  return t('dates.daysAway', { count: whole })
}

/**
 * Builds the countdown shown on posters, timeline rows and detail pages.
 *
 * Fuzzy schedules deliberately never render a day count: `quarter` stays
 * "预计 2027 年第四季度" rather than being flattened into a fake day number.
 */
export function countdownFor(
  event: ResolvedEvent,
  now: Date | string = new Date(),
  locale: string = currentLanguage(),
): Countdown {
  const clock = new Date(now)
  const schedule = event.currentSchedule ?? selectCurrentSchedule(event.schedule, clock)
  if (!schedule) {
    return {
      headline: i18n.t('messages.date_tbd', { lng: locale }),
      dateLabel: '',
      precision: 'unknown',
      daysUntil: null,
      ongoing: false,
      past: false,
    }
  }

  const precision = precisionOf(schedule.value)
  const next = event.recurrence ? eventInterval(event, clock)?.start : undefined
  const displayValue = next && schedule.value.kind === 'exact' ? { ...schedule.value, date: next.toISOString().slice(0, 10) }
    : next && schedule.value.kind === 'datetime' ? { ...schedule.value, dateTime: next.toISOString() } : schedule.value
  const dateLabel = describeTemporal(displayValue, locale)
  const ongoing = isEventOngoing(event, clock)
  const days = daysUntilEvent(event, clock)

  if (precision === 'unknown' || days === null) {
    return {
      headline: i18n.t('messages.date_tbd', { lng: locale }),
      dateLabel: precision === 'unknown' ? dateLabel : '',
      precision: 'unknown',
      daysUntil: null,
      ongoing,
      past: false,
    }
  }

  if (ongoing) {
    return {
      headline: i18n.t('messages.ongoing', { lng: locale }),
      dateLabel,
      precision,
      daysUntil: 0,
      ongoing: true,
      past: false,
    }
  }

  return {
    headline:
      precision === 'exact' ? exactHeadline(days, locale) : approximateHeadline(schedule.value, days, locale),
    dateLabel,
    precision,
    daysUntil: days,
    ongoing: false,
    past: days < 0,
  }
}

/** Renders how a date firmed up over time (manual section 29). */
export function describeScheduleChange(
  previous: TemporalValue,
  next: TemporalValue,
  locale: string = currentLanguage(),
): string {
  return `${describeTemporal(previous, locale)} → ${describeTemporal(next, locale)}`
}
