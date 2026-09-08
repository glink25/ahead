import type { LoadedFeed } from '../lib/feed-loader'
export type SearchErrorReason =
  | 'authentication-required'
  | 'authentication-expired'
  | 'rate-limited'
  | 'search-unavailable'
  | 'incomplete-results'

export type SearchFeedEvent =
  | { type: 'feed'; feed: LoadedFeed; cached: boolean }
  | {
      type: 'error'
      message: string
      reason: SearchErrorReason
      limited: boolean
    }
  | { type: 'progress'; loaded: number; complete: boolean }

export type SearchFeedStatus = 'idle' | 'searching' | 'paused' | 'complete' | 'failed'
export type SearchRequest = { query: string; tag?: never } | { query?: never; tag: string }

export interface SearchFeedSession {
  setActive(active: boolean): void
  reportVisible(index: number, available: number): void
  retry(): Promise<void>
  close(): void
}

export interface SearchProvider {
  openSession(options: { request: SearchRequest; receive: (event: SearchFeedEvent) => void; status: (status: SearchFeedStatus) => void }): SearchFeedSession
}
