import { beforeAll, expect, it } from 'vitest'
import { initializeI18n, changeLanguage, i18n } from '../i18n'
import { pickLocalizedText, pickText, describeTemporal, countdownFor } from './format'
import { fieldsFor } from '../features/studio/StudioView'
import { resolvedEvent } from './test-fixtures'

beforeAll(async () => { await initializeI18n(); await changeLanguage('zh-CN'); await changeLanguage('en') })
it('selects exact, base-language, then original text with its real key', () => {
  const text = { 'zh-CN': '中文', 'en-GB': 'English' }
  expect(pickLocalizedText(text, 'en-US')).toEqual({ text: 'English', language: 'en-GB' })
  expect(pickLocalizedText(text, 'fr')).toEqual({ text: '中文', language: 'zh-CN' })
  expect(pickLocalizedText(undefined, 'en')).toEqual({ text: '', language: 'en' })
  expect(pickText({ 'EN-us': 'Exact', en: 'Base' }, 'en-US')).toBe('Exact')
})
it('captures field languages separately and retains other translations when editing', async () => {
  const event = { ...resolvedEvent(), title: { 'zh-CN': '中文', 'en-GB': 'English' }, description: { 'zh-CN': '原文' } }
  const fields = fieldsFor(event, 'en')
  expect(fields.titleLanguage).toBe('en-GB')
  expect(fields.notesLanguage).toBe('zh-CN')
  await changeLanguage('zh-CN')
  expect(fields.title).toBe('English')
  expect(fields.titleLanguage).toBe('en-GB')
})
it('formats dates and plural countdowns without changing date precision', () => {
  const event = resolvedEvent('test', { kind: 'exact', date: '2027-01-10' })
  expect(countdownFor(event, '2027-01-01', 'en').headline).toBe('9 days away')
  expect(countdownFor(event, '2027-01-11', 'en').headline).toBe('1 day ago')
  expect(countdownFor(event, '2027-01-12', 'en').headline).toBe('2 days ago')
  expect(countdownFor(event, '2027-01-09', 'en').headline).toBe('Tomorrow')
  expect(countdownFor(event, '2027-01-10', 'en').headline).toBe('Today')
  expect(describeTemporal({ kind: 'quarter', year: 2027, quarter: 4 }, 'en')).toBe('Q4 2027')
  expect(describeTemporal({ kind: 'exact', date: '2027-01-01' }, 'en')).toBe('January 1, 2027')
  expect(describeTemporal({ kind: 'datetime', dateTime: '2027-01-01T16:00:00Z', timezone: 'Asia/Shanghai' }, 'en')).toContain('January 2, 2027')
  expect(i18n.t('duration.days', { lng: 'en', count: 1 })).toBe('Lasts 1 day')
  expect(i18n.t('duration.days', { lng: 'en', count: 2 })).toBe('Lasts 2 days')
})
