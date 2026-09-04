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
  '0-7d': '一周内',
  '7-30d': '本月',
  '1-3m': '三个月内',
  '3-12m': '今年',
  '1y+': '更远以后',
  unknown: '日期待定',
}

export const CONFIDENCE_LABELS: Record<ScheduleConfidence, string> = {
  confirmed: '官方确认',
  likely: '大概率',
  rumored: '传闻',
  cancelled: '已取消',
}

const QUARTER_LABELS = ['第一季度', '第二季度', '第三季度', '第四季度'] as const

export function pickText(text: LocalizedText | undefined, locale = 'zh-CN'): string {
  if (!text) return ''
  const language = locale.split('-')[0]!
  return (
    text[locale] ??
    Object.entries(text).find(([key]) => key.split('-')[0] === language)?.[1] ??
    Object.values(text)[0] ??
    ''
  )
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`
}

/** Human description of a temporal value, without any countdown. */
export function describeTemporal(value: TemporalValue, locale = 'zh-CN'): string {
  switch (value.kind) {
    case 'exact':
      return formatDay(value.date)
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
      return `${value.year} 年 ${value.month} 月`
    case 'quarter':
      return `${value.year} 年${QUARTER_LABELS[value.quarter - 1] ?? ''}`
    case 'year':
      return `${value.year} 年`
    case 'range':
      return `${describeTemporal(value.start, locale)} — ${describeTemporal(value.end, locale)}`
    case 'unknown':
      return pickText(value.note, locale) || '日期待定'
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
  if (days < 0) return `${describeTemporal(value, locale)}（已过去）`
  switch (value.kind) {
    case 'month': {
      const months = Math.max(1, Math.round(days / 30))
      return `大约还有 ${months} 个月`
    }
    case 'quarter':
      return `预计 ${value.year} 年${QUARTER_LABELS[value.quarter - 1] ?? ''}`
    case 'year':
      return `预计 ${value.year} 年`
    case 'range':
      return `预计 ${describeTemporal(value, locale)}`
    default:
      return describeTemporal(value, locale)
  }
}

function exactHeadline(days: number): string {
  const whole = Math.ceil(days)
  if (whole < 0) return `已过去 ${Math.abs(Math.floor(days))} 天`
  if (whole === 0) return '就在今天'
  if (whole === 1) return '就在明天'
  return `还有 ${whole} 天`
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
  locale = 'zh-CN',
): Countdown {
  const clock = new Date(now)
  const schedule = event.currentSchedule ?? selectCurrentSchedule(event.schedule, clock)
  if (!schedule) {
    return {
      headline: '日期待定',
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
      headline: '日期待定',
      dateLabel: precision === 'unknown' ? dateLabel : '',
      precision: 'unknown',
      daysUntil: null,
      ongoing,
      past: false,
    }
  }

  if (ongoing) {
    return {
      headline: '正在进行',
      dateLabel,
      precision,
      daysUntil: 0,
      ongoing: true,
      past: false,
    }
  }

  return {
    headline:
      precision === 'exact' ? exactHeadline(days) : approximateHeadline(schedule.value, days, locale),
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
  locale = 'zh-CN',
): string {
  return `${describeTemporal(previous, locale)} → ${describeTemporal(next, locale)}`
}
