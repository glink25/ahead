import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'
import enCore from './locales/en/core.json'
import zhCore from './locales/zh-CN/core.json'

export const languages = ['zh-CN', 'en'] as const
export const featureNamespaces = ['discover', 'mine', 'event', 'following', 'profiles', 'settings', 'login', 'studio', 'search'] as const
export type AppLanguage = (typeof languages)[number]
export type FeatureNamespace = (typeof featureNamespaces)[number]
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
const resourceUrls = import.meta.glob(['./locales/*/*.json', '!./locales/*/core.json'], {
  eager: true,
  import: 'default',
  query: '?url&no-inline',
}) as Record<string, string>
const namespacePromises = new Map<string, Promise<void>>()
const loadedNamespaces = new Map<AppLanguage, Set<string>>([
  ['en', new Set(['core', 'event', 'settings', 'studio'])],
  ['zh-CN', new Set(['core', 'event', 'settings', 'studio'])],
])
const loadedPaths = new Set<string>()
let initialized = false
let changeVersion = 0
export function currentLanguage(): AppLanguage {
  return resolveLanguage([i18n.resolvedLanguage || i18n.language || 'en'])
}
export function hasNamespace(namespace: FeatureNamespace, language = currentLanguage()) {
  return loadedNamespaces.get(language)?.has(namespace) ?? false
}
function resourceUrl(language: AppLanguage, namespace: FeatureNamespace) {
  return resourceUrls[`./locales/${language}/${namespace}.json`]
}
async function fetchNamespace(language: AppLanguage, namespace: FeatureNamespace) {
  const url = resourceUrl(language, namespace)
  if (!url) throw new Error(`Unsupported translation namespace: ${language}/${namespace}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Translation HTTP ${response.status}`)
  i18n.addResourceBundle(language, 'translation', await response.json(), true, true)
  loadedNamespaces.get(language)!.add(namespace)
  loadedPaths.add(new URL(url, location.href).pathname)
}
export function ensureNamespace(namespace: FeatureNamespace, language = currentLanguage()): Promise<void> {
  if (loadedNamespaces.get(language)?.has(namespace)) return Promise.resolve()
  const key = `${language}/${namespace}`
  let promise = namespacePromises.get(key)
  if (!promise) {
    promise = fetchNamespace(language, namespace).catch((error) => {
      namespacePromises.delete(key)
      throw error
    })
    namespacePromises.set(key, promise)
  }
  return promise
}
export function useFeatureTranslations(namespace: FeatureNamespace) {
  const { i18n: instance } = useTranslation()
  const language = resolveLanguage([instance.resolvedLanguage || instance.language])
  if (!loadedNamespaces.get(language)?.has(namespace)) throw ensureNamespace(namespace, language)
}

/** Reconcile resources loaded before the service worker took control. */
export async function cacheLoadedLanguages() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const active = registration.active
  for (const path of loadedPaths) active?.postMessage({ type: 'CACHE_TRANSLATION', path })
  active?.postMessage({ type: 'CACHE_TRANSLATION', path: `/reset-locales/${currentLanguage()}.js` })
}
function updateDocument() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = currentLanguage()
  document.title = i18n.t('language.appTitle')
}

/** Core translations are bundled, so initialization finishes before React mounts. */
export function initializeI18n(): void {
  if (initialized) return
  initialized = true
  const preference = readLanguagePreference()
  void i18n
    .use(detector)
    .use(initReactI18next)
    .use(resourcesToBackend(async (language: string, namespace: string) => {
      await ensureNamespace(namespace as FeatureNamespace, resolveLanguage([language]))
      return i18n.getResourceBundle(language, 'translation')
    }))
    .init({
      initAsync: false,
      lng: preference === 'auto' ? browserLanguage() : preference,
      resources: {
        en: { translation: enCore },
        'zh-CN': { translation: zhCore },
      },
      ns: ['translation'],
      defaultNS: 'translation',
      supportedLngs: [...languages],
      load: 'currentOnly',
      fallbackLng: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: true },
    })
  i18n.on('languageChanged', updateDocument)
  updateDocument()
}

/** Load visible feature resources first, then commit the language change. */
export async function changeLanguage(preference: LanguagePreference): Promise<void> {
  if (preference !== 'auto' && !languages.includes(preference))
    throw new Error('Unsupported language')
  const version = ++changeVersion
  const language = preference === 'auto' ? browserLanguage() : preference
  const visible = [...(loadedNamespaces.get(currentLanguage()) ?? [])]
    .filter((value): value is FeatureNamespace => value !== 'core')
  await Promise.all(visible.map((namespace) => ensureNamespace(namespace, language)))
  if (version !== changeVersion) return
  await i18n.changeLanguage(language)
  try {
    if (preference === 'auto') localStorage.removeItem(languageStorageKey)
    else localStorage.setItem(languageStorageKey, preference)
  } catch { /* The in-memory selection remains usable. */ }
  if (import.meta.env.PROD) void cacheLoadedLanguages()
}

export function displayMessage(value: string): string {
  return value.replace(/messages\.[a-z0-9_]+/g, (key) => String(i18n.t(key)))
}
