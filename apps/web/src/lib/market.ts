import { APPROVED_LABEL, parseMarketIssueBody, type MarketEntry } from '@ahead/market'
import { sourceKey } from '@ahead/protocol'

/** A market listing plus the presentation metadata carried by its Issue. */
export interface MarketListing extends MarketEntry {
  issueNumber: number
  issueUrl: string
  title: string
  labels: string[]
}

interface GitHubIssue {
  number: number
  title: string
  body?: string | null
  html_url: string
  pull_request?: unknown
  labels: Array<{ name?: string } | string>
}

export interface LoadMarketOptions {
  repository: string
  fetcher?: typeof globalThis.fetch
  perPage?: number
}

function labelNames(labels: GitHubIssue['labels']): string[] {
  return labels
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((name): name is string => Boolean(name))
}

/**
 * Reads the approved market registry.
 *
 * Issues are a lightweight registry, not a copy of repository content.
 */
export async function loadMarketListings(options: LoadMarketOptions): Promise<MarketListing[]> {
  const fetcher: typeof globalThis.fetch = options.fetcher ?? ((input, init) => globalThis.fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) }))
  const query = new URLSearchParams({
    state: 'open',
    labels: APPROVED_LABEL,
    per_page: String(options.perPage ?? 100),
  })
  const listings: MarketListing[] = []
  const seen = new Set<string>()
  for (let page = 1; ; page += 1) {
  query.set('page', String(page))
  const response = await fetcher(
    `https://api.github.com/repos/${options.repository}/issues?${query}`,
    { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' },
  )
  if (!response.ok) {
    throw new Error(`读取市场失败：HTTP ${response.status}`)
  }

  const issues = (await response.json()) as GitHubIssue[]
  for (const issue of issues) {
    if (issue.pull_request) continue
    const entry = parseMarketIssueBody(issue.body ?? '')
    if (!entry) continue
    if (!labelNames(issue.labels).includes(APPROVED_LABEL)) continue
    let key: string
    try { key = sourceKey(entry.source) } catch { continue }
    if (seen.has(key)) continue
    seen.add(key)
    listings.push({
      ...entry,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      title: issue.title,
      labels: labelNames(issue.labels),
    })
  }
  if (!response.headers.get('link')?.includes('rel="next"')) break
  }
  return listings
}
