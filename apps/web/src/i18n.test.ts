import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { i18n, initializeI18n, resolveLanguage, readLanguagePreference, changeLanguage, displayMessage, languageStorageKey } from './i18n'
import en from './locales/en.json'
import zh from './locales/zh-CN.json'

beforeAll(initializeI18n)
afterEach(() => vi.unstubAllGlobals())
it('matches ordered browser preferences and falls back to English', () => {
  expect(resolveLanguage(['fr-FR', 'zh-TW', 'en-US'])).toBe('zh-CN')
  expect(resolveLanguage(['en-GB', 'zh-CN'])).toBe('en')
  expect(resolveLanguage(['ZH_hans_CN'])).toBe('zh-CN')
  expect(resolveLanguage(['fr', 'ja'])).toBe('en')
  expect(resolveLanguage([])).toBe('en')
})
it('persists explicit selection, clears it for browser mode, and tolerates denied storage', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('navigator', { languages: ['en-GB'] })
  expect(readLanguagePreference()).toBe('auto')
  values.set(languageStorageKey, 'invalid')
  expect(readLanguagePreference()).toBe('auto')
  await changeLanguage('zh-CN')
  expect(readLanguagePreference()).toBe('zh-CN')
  expect(i18n.resolvedLanguage).toBe('zh-CN')
  expect(displayMessage('Error: messages.local_profile')).toBe('Error: 本机资料')
  await changeLanguage('auto')
  expect(readLanguagePreference()).toBe('auto')
  expect(i18n.resolvedLanguage).toBe('en')
  expect(displayMessage('Error: messages.local_profile')).toBe('Error: Local profile')
  vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } })
  expect(readLanguagePreference()).toBe('auto')
  await changeLanguage('zh-CN')
  expect(i18n.resolvedLanguage).toBe('zh-CN')
})
it('does not commit an unsupported language', async () => {
  await changeLanguage('en')
  await expect(changeLanguage('fr' as never)).rejects.toThrow('Unsupported language')
  expect(i18n.resolvedLanguage).toBe('en')
})
function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix + key
    return typeof entry === 'string' ? [[path, entry]] : Object.entries(flatten(entry as Record<string, unknown>, path + '.'))
  }))
}
describe('translation catalog contract', () => {
  const english = flatten(en), chinese = flatten(zh)
  it('has identical nonempty keys, interpolation parameters and plural forms', () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort())
    for (const [key, value] of Object.entries(english)) {
      expect(value.trim(), key).not.toBe('')
      expect(chinese[key]?.trim(), key).not.toBe('')
      expect(value.match(/{{[^}]+}}/g)?.sort(), key).toEqual(chinese[key]?.match(/{{[^}]+}}/g)?.sort())
    }
  })
})
