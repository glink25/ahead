import { currentLanguage } from '../i18n'
import type { ResourceLocator } from '@ahead/core'
import { buildJsDelivrUrl } from '@ahead/github'
import type { Event, EventMedia } from '@ahead/schema'

/** Deterministic gradients used when an event has no usable image. */
const FALLBACK_GRADIENTS = [
  ['#0f172a', '#1e3a5f'],
  ['#2a1035', '#5b2333'],
  ['#0b2027', '#14524a'],
  ['#231b3a', '#4c2a6b'],
  ['#2b1a0f', '#6b3d1f'],
  ['#101a2b', '#2f4a7a'],
] as const

export interface PosterSource {
  /** Absolute image URL, or undefined when no image should be loaded. */
  url?: string
  alt: string
  gradient: readonly [string, string]
  /** True when an image exists but privacy mode suppressed it. */
  suppressed: boolean
}

export interface PosterOptions {
  locator?: ResourceLocator
  /** Pins repo-relative paths to a commit so the URL is immutable. */
  headSha?: string
  /** Branch used when no commit is known; only affects repo-relative paths. */
  ref?: string
  allowRemoteImages?: boolean
  locale?: string
}

function hash(value: string): number {
  let accumulator = 0
  for (let index = 0; index < value.length; index += 1) {
    accumulator = (accumulator * 31 + value.charCodeAt(index)) % 0xffffffff
  }
  return accumulator
}

export function gradientFor(eventId: string): readonly [string, string] {
  return FALLBACK_GRADIENTS[hash(eventId) % FALLBACK_GRADIENTS.length]!
}

function pickImage(media: EventMedia[] | undefined): EventMedia | undefined {
  return media?.find((item) => (item.kind ?? 'image') === 'image')
}

function localized(text: Record<string, string> | undefined, locale: string): string {
  if (!text) return ''
  const language = locale.split('-')[0]!
  return (
    text[locale] ??
    Object.entries(text).find(([key]) => key.split('-')[0] === language)?.[1] ??
    Object.values(text)[0] ??
    ''
  )
}

/**
 * Resolves an event's poster image.
 *
 * `media[].path` is either an absolute https URL or a path relative to the
 * repository root - the latter only becomes fetchable once paired with a
 * locator, so unresolvable paths degrade to the gradient rather than 404.
 */
export function posterFor(event: Event, options: PosterOptions = {}): PosterSource {
  const locale = options.locale ?? currentLanguage()
  const gradient = gradientFor(event.id)
  const image = pickImage(event.media)
  const alt = localized(image?.alt, locale) || localized(event.title, locale)

  if (!image) return { alt, gradient, suppressed: false }

  const isRemote = /^https:\/\//u.test(image.path)
  if (isRemote && options.allowRemoteImages === false) {
    return { alt, gradient, suppressed: true }
  }
  if (isRemote) return { url: image.path, alt, gradient, suppressed: false }

  // Reject non-https absolute URLs outright rather than letting a mixed-content
  // or javascript: path reach an img tag.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(image.path)) {
    return { alt, gradient, suppressed: false }
  }
  if (!options.locator) return { alt, gradient, suppressed: false }
  if (image.path.startsWith('/') || image.path.includes('\\') || image.path.split('/').some((part) => !part || part === '.' || part === '..')) return { alt, gradient, suppressed: false }

  const ref = options.headSha ?? options.ref ?? options.locator.ref ?? 'HEAD'
  return {
    url: buildJsDelivrUrl(options.locator, ref, image.path),
    alt,
    gradient,
    suppressed: false,
  }
}
