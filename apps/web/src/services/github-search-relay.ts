import type { GitHubCodeSearchResult, GitHubSearchAdapter } from '@ahead/github'

export class GitHubSearchRelayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GitHubSearchRelayError'
  }
}

// web由于cors限制必须通过稳定后端进行中转，原生app端可以不需要
export function createGitHubSearchRelay(options: {
  baseUrl: string
  getAccessToken: () => Promise<string>
  fetcher?: typeof fetch
}): GitHubSearchAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/u, '')
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  return {
    async searchCode(query, page = 1, perPage = 100, signal) {
      if (!baseUrl) throw new Error('GitHub search relay is not configured')
      const url = new URL(baseUrl + '/api/github/search/code')
      url.searchParams.set('q', query)
      url.searchParams.set('page', String(page))
      url.searchParams.set('per_page', String(perPage))
      const token = await options.getAccessToken()
      const response = await fetcher(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
        signal,
      })
      const text = await response.text()
      if (!response.ok) {
        let detail = text.slice(0, 300)
        try { detail = (JSON.parse(text) as { message?: string }).message ?? detail }
        catch { /* The relay may return a plain-text edge error. */ }
        throw new GitHubSearchRelayError(
          `GitHub code search failed with HTTP ${response.status}: ${detail}`,
          response.status,
        )
      }
      let body: unknown
      try { body = JSON.parse(text) }
      catch { throw new GitHubSearchRelayError('GitHub search relay returned invalid JSON', 502) }
      if (!isCodeSearchResult(body))
        throw new GitHubSearchRelayError('GitHub search relay returned an invalid response', 502)
      return body
    },
  }
}

function isCodeSearchResult(value: unknown): value is GitHubCodeSearchResult {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<GitHubCodeSearchResult>
  return typeof body.total_count === 'number' &&
    typeof body.incomplete_results === 'boolean' &&
    Array.isArray(body.items) && body.items.every((item) =>
      typeof item?.path === 'string' &&
      typeof item.repository?.name === 'string' &&
      typeof item.repository.owner?.login === 'string')
}
