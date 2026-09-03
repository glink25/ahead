import type { MarketEntry, MarketSourceMetadata } from './types.js'

export const MARKET_MANIFEST_START = '<!-- ahead:manifest:start -->'
export const MARKET_MANIFEST_END = '<!-- ahead:manifest:end -->'
export const MARKET_SOURCE_PATTERN = /<!--\s*ahead:source:(\{[\s\S]*?\})\s*-->/

function isSourceMetadata(value: unknown): value is MarketSourceMetadata {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MarketSourceMetadata>
  return (
    candidate.schema === 1 &&
    typeof candidate.locator === 'string' &&
    /^[a-z][a-z0-9+.-]*:.+$/u.test(candidate.locator) &&
    (candidate.manifestPath === undefined || typeof candidate.manifestPath === 'string') &&
    (candidate.resourceType === 'event-feed' || candidate.resourceType === 'user-data')
  )
}

export function parseMarketIssueBody(body: string): MarketEntry | null {
  const sourceMatch = MARKET_SOURCE_PATTERN.exec(body)
  if (!sourceMatch?.[1]) return null

  let source: unknown
  try {
    source = JSON.parse(sourceMatch[1])
  } catch {
    return null
  }
  if (!isSourceMetadata(source)) return null

  const start = body.indexOf(MARKET_MANIFEST_START)
  const end = start < 0 ? -1 : body.indexOf(MARKET_MANIFEST_END, start + MARKET_MANIFEST_START.length)
  const manifest =
    start >= 0 && end >= 0
      ? body.slice(start + MARKET_MANIFEST_START.length, end).trim()
      : undefined

  return manifest === undefined ? { source } : { source, manifest }
}

export function serializeManifestBlock(manifest: string): string {
  return `${MARKET_MANIFEST_START}\n${manifest.trim()}\n${MARKET_MANIFEST_END}`
}

export function serializeSourceBlock(source: MarketSourceMetadata): string {
  return `<!-- ahead:source:${JSON.stringify(source)} -->`
}
