export type SerializedLocator = `${string}:${string}`

export interface GenericLocator {
  scheme: string
  reference: string
}

export interface ResourceLocator {
  scheme: 'github'
  owner: string
  repo: string
  ref?: string
}

export type GitHubLocator = ResourceLocator
export type ParsedLocator = GenericLocator | ResourceLocator

export interface LocatorScheme<T extends ParsedLocator = ParsedLocator> {
  parse(reference: string): Omit<T, 'scheme'>
  serialize(locator: T): string
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/
const schemes = new Map<string, LocatorScheme>()

export function registerScheme<T extends ParsedLocator>(
  scheme: string,
  codec: LocatorScheme<T>,
): void {
  const normalized = scheme.toLowerCase()
  if (!SCHEME_PATTERN.test(normalized)) {
    throw new TypeError(`Invalid locator scheme: ${scheme}`)
  }
  schemes.set(normalized, codec as LocatorScheme)
}

export function parseLocator(locator: string): ParsedLocator {
  const separator = locator.indexOf(':')
  if (separator <= 0 || separator === locator.length - 1) {
    throw new TypeError(`Invalid resource locator: ${locator}`)
  }

  const scheme = locator.slice(0, separator).toLowerCase()
  const reference = locator.slice(separator + 1)
  if (!SCHEME_PATTERN.test(scheme)) {
    throw new TypeError(`Invalid locator scheme: ${scheme}`)
  }

  const codec = schemes.get(scheme)
  if (!codec) {
    return { scheme, reference }
  }

  return { ...codec.parse(reference), scheme } as ParsedLocator
}

export function serializeLocator(locator: ParsedLocator): SerializedLocator {
  const scheme = locator.scheme.toLowerCase()
  if (!SCHEME_PATTERN.test(scheme)) {
    throw new TypeError(`Invalid locator scheme: ${locator.scheme}`)
  }

  const codec = schemes.get(scheme)
  const reference = codec
    ? codec.serialize(locator)
    : 'reference' in locator
      ? locator.reference
      : ''

  if (!reference || /[\r\n]/u.test(reference)) {
    throw new TypeError(`Invalid locator reference for scheme: ${scheme}`)
  }
  return `${scheme}:${reference}`
}

/** Short alias used by protocol consumers. */
export const serialize = serializeLocator

registerScheme<GitHubLocator>('github', {
  parse(reference) {
    const parts = reference.split('/')
    if (parts.length !== 2 || parts.some((part) => !part)) {
      throw new TypeError(`Invalid GitHub locator reference: ${reference}`)
    }
    return { owner: parts[0]!, repo: parts[1]! }
  },
  serialize(locator) {
    if (!locator.owner || !locator.repo || locator.owner.includes('/') || locator.repo.includes('/')) {
      throw new TypeError('Invalid GitHub locator')
    }
    return `${locator.owner}/${locator.repo}`
  },
})
