export const DEFAULT_MANIFEST_PATH = 'ahead.yaml'

/** Repository-root relative paths only; never normalize away traversal. */
export function manifestPath(path = DEFAULT_MANIFEST_PATH): string {
  if (!path || path.startsWith('/') || /[\\?#\u0000-\u001f]/u.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`Invalid manifest path: ${path}`)
  }
  return path
}

/** Internal resource identity, not a repository locator. Legacy roots stay stable. */
export function sourceKey(source: { locator: string; manifestPath?: string }): string {
  if (source.locator.startsWith('github:') && !/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(source.locator)) throw new TypeError('Invalid GitHub source locator')
  const path = manifestPath(source.manifestPath)
  const locator = source.locator.startsWith('github:') ? source.locator.toLowerCase() : source.locator
  return path === DEFAULT_MANIFEST_PATH ? locator : `${locator}#${encodeURIComponent(path)}`
}

/** Decode the canonical GitHub resource identity produced by sourceKey(). */
export function parseSourceKey(key: string): { locator: string; manifestPath?: string } {
  const parts = key.split('#')
  if (parts.length > 2) throw new TypeError('Invalid source key')
  const locator = parts[0]!
  if (!/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(locator))
    throw new TypeError('Invalid GitHub source key')
  if (parts.length === 1) return { locator: locator.toLowerCase() }
  if (!parts[1]) throw new TypeError('Invalid source key manifest path')
  let path: string
  try {
    path = manifestPath(decodeURIComponent(parts[1]))
  } catch {
    throw new TypeError('Invalid source key manifest path')
  }
  return {
    locator: locator.toLowerCase(),
    ...(path === DEFAULT_MANIFEST_PATH ? {} : { manifestPath: path }),
  }
}
