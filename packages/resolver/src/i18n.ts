import type { LocalizedText } from '@ahead/schema'
import { resolveLocalizedText as resolveProtocolLocalizedText } from '@ahead/protocol'

/** Resolve OEF localized text through the protocol's canonical fallback rules. */
export function resolveLocalizedText(
  text: LocalizedText,
  locale: string,
  fallbacks: string[] = [],
): string {
  return resolveProtocolLocalizedText(text, locale, fallbacks)
}
