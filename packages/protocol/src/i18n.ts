export type LocalizedText = string | Readonly<Record<string, string>>

function localeCandidates(locale: string): string[] {
  const normalized = locale.trim().replaceAll('_', '-').toLowerCase()
  if (!normalized) return []
  const language = normalized.split('-')[0]
  return language && language !== normalized ? [normalized, language] : [normalized]
}

export function resolveLocalizedText(
  text: LocalizedText,
  locale: string,
  fallbacks: string[] = [],
): string {
  if (typeof text === 'string') return text

  const byLocale = new Map(
    Object.entries(text).map(([key, value]) => [key.replaceAll('_', '-').toLowerCase(), value]),
  )
  const candidates = [locale, ...fallbacks].flatMap(localeCandidates)

  for (const candidate of candidates) {
    const value = byLocale.get(candidate)
    if (value !== undefined) return value
  }

  return Object.values(text)[0] ?? ''
}
