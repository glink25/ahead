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
