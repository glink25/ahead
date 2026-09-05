import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'
import zhCNUrl from './locales/zh-CN.json?url'
import enUrl from './locales/en.json?url'

export const languages = ['zh-CN', 'en'] as const
export type AppLanguage = (typeof languages)[number]
export type LanguagePreference = AppLanguage | 'auto'
export const languageStorageKey = 'ahead-language'

export function resolveLanguage(candidates: readonly string[]): AppLanguage {
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split(/[-_]/)[0]
    if (base === 'zh') return 'zh-CN'
    if (base === 'en') return 'en'
  }
  return 'en'
}
export function readLanguagePreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(languageStorageKey)
    if (languages.includes(value as AppLanguage)) return value as AppLanguage
  } catch { /* Storage may be disabled; language switching still works. */ }
  return 'auto'
}
const detector = new LanguageDetector(undefined, { order: ['navigator'], caches: [] })
export function browserLanguage(): AppLanguage {
  const detected = detector.detect()
  return resolveLanguage(Array.isArray(detected) ? detected : detected ? [detected] : [])
}
export const i18n = i18next.createInstance()
const resources = {
  'zh-CN': zhCNUrl,
  en: enUrl,
}
const loaded = new Set<AppLanguage>()
let initialization: Promise<void> | undefined
let changeVersion = 0
export function currentLanguage(): AppLanguage {
  return resolveLanguage([i18n.resolvedLanguage || i18n.language || 'en'])
}

/** Reconcile resources loaded before the service worker took control. */
export async function cacheLoadedLanguages() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  for (const language of loaded)
    registration.active?.postMessage({ type: 'CACHE_LANGUAGE', language })
}
function updateDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = currentLanguage()
  document.title = i18n.t('language.appTitle')
}
async function loadLanguage(language: AppLanguage): Promise<Record<string, unknown>> {
  if (!languages.includes(language)) throw new Error('Unsupported language')
  if (import.meta.env.MODE === 'test') {
    const resource = language === 'zh-CN'
      ? await import('./locales/zh-CN.json')
      : await import('./locales/en.json')
    loaded.add(language)
    return resource.default
  }
  const response = await fetch(resources[language])
  if (!response.ok) throw new Error(`Language HTTP ${response.status}`)
  loaded.add(language)
  return response.json()
}
export function initializeI18n(): Promise<void> {
  initialization ??= (async () => {
    const preference = readLanguagePreference()
    await i18n
      .use(detector)
      .use(initReactI18next)
      .use(resourcesToBackend(async (language: string) => {
        return loadLanguage(language as AppLanguage)
      }))
      .init({
        lng: preference === 'auto' ? browserLanguage() : preference,
        supportedLngs: [...languages],
        load: 'currentOnly',
        fallbackLng: false,
        interpolation: { escapeValue: false },
        react: { useSuspense: true },
      })
    if (!i18n.hasResourceBundle(i18n.language, 'translation'))
      throw new Error('Language resources unavailable')
    i18n.on('languageChanged', updateDocument)
    updateDocument()
  })().catch((error) => { initialization = undefined; throw error })
  return initialization
}

/** Load first, then commit. A failed or superseded request cannot change the UI. */
export async function changeLanguage(preference: LanguagePreference): Promise<void> {
  const version = ++changeVersion
  const language = preference === 'auto' ? browserLanguage() : preference
  if (!i18n.hasResourceBundle(language, 'translation')) {
    const resource = await loadLanguage(language)
    i18n.addResourceBundle(language, 'translation', resource, true, true)
  }
  if (version !== changeVersion) return
  await i18n.changeLanguage(language)
  try {
    if (preference === 'auto') localStorage.removeItem(languageStorageKey)
    else localStorage.setItem(languageStorageKey, preference)
  } catch { /* The in-memory selection remains usable. */ }
  if (import.meta.env.PROD) void cacheLoadedLanguages()
}

/** Error codes remain stable in stores and are translated at the display boundary. */
export function displayMessage(value: string): string {
  return value.replace(/messages\.[a-z0-9_]+/g, (key) => String(i18n.t(key)))
}
