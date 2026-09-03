import { describe, expect, it } from 'vitest'
import { resolveLocalizedText } from './i18n.js'

describe('resolveLocalizedText', () => {
  const text = {
    en: 'Ahead',
    'zh-CN': '盼头',
    ja: '楽しみ',
  }

  it('resolves exact and language-only locale matches', () => {
    expect(resolveLocalizedText(text, 'zh-CN')).toBe('盼头')
    expect(resolveLocalizedText({ zh: '中文' }, 'zh-Hans-CN')).toBe('中文')
  })

  it('uses explicit fallbacks in order', () => {
    expect(resolveLocalizedText(text, 'fr-FR', ['ja', 'en'])).toBe('楽しみ')
  })

  it('returns strings and falls back to the first translation', () => {
    expect(resolveLocalizedText('plain', 'zh-CN')).toBe('plain')
    expect(resolveLocalizedText(text, 'fr-FR')).toBe('Ahead')
  })
})
