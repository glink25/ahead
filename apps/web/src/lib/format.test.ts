import { beforeAll } from 'vitest'
import { initializeI18n, i18n } from '../i18n'
beforeAll(async () => { await initializeI18n(); await i18n.changeLanguage('zh-CN') })
import { it, expect } from 'vitest'
import { countdownFor, describeTemporal, pickText } from './format'
import { resolvedEvent } from './test-fixtures'
it('never renders day precision for uncertain dates', () => {
  for (const value of [
    { kind: 'month', year: 2027, month: 3 }, { kind: 'quarter', year: 2027, quarter: 4 },
    { kind: 'year', year: 2027 }, { kind: 'unknown' },
  ] as const) {
    const countdown = countdownFor(resolvedEvent('test', value), '2027-01-01')
    expect(countdown.precision).not.toBe('exact')
    expect(countdown.headline).not.toMatch(/还有 \d+ 天/)
  }
  expect(countdownFor(resolvedEvent(), '2027-01-01').headline).toBe('还有 9 天')
})
it('supports localized fallback, ranges, timezone and ongoing durations', () => {
  expect(pickText({ en: 'English' })).toBe('English')
  expect(describeTemporal({ kind: 'range', start: { kind: 'year', year: 2027 }, end: { kind: 'year', year: 2028 } })).toContain('2027 年 — 2028 年')
  expect(describeTemporal({ kind: 'datetime', dateTime: '2027-01-01T16:00:00Z', timezone: 'Asia/Shanghai' })).toContain('2027年1月2日')
  expect(countdownFor({ ...resolvedEvent(), duration: { amount: 3, unit: 'days' } }, '2027-01-11').headline).toBe('正在进行')
})
it('counts toward the next yearly occurrence instead of an expired seed date', () => {
  const event = { ...resolvedEvent('holiday', { kind: 'exact', date: '2020-10-01' }), recurrence: { freq: 'yearly' as const }, duration: { amount: 7, unit: 'days' as const } }
  expect(countdownFor(event, '2027-09-01').headline).toBe('还有 30 天')
  expect(countdownFor(event, '2027-09-01').dateLabel).toContain('2027年')
  expect(countdownFor(event, '2027-10-04').headline).toBe('正在进行')
})
