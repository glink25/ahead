import type { EventFeed, Subscription, UserData } from '@ahead/schema'
import type { MarketEntry } from '@ahead/market'
export type Source = Pick<Subscription, 'locator' | 'manifestPath' | 'kind'>
export interface ContentResult {
  document?: EventFeed | UserData
  version: string
  private: boolean
}
export interface ContentProvider {
  readonly scheme: string
  read(source: Source, options: { version?: string; signal?: AbortSignal; refresh?: boolean }): Promise<ContentResult>
  mediaUrl(source: Source, version: string | undefined, path: string): string | undefined
}
export interface MarketListing extends MarketEntry {
  id: string
  url?: string
  title: string
  labels: string[]
}
export interface MarketProvider {
  readonly id: string
  list(options: { cursor?: string; signal?: AbortSignal; refresh?: boolean }): Promise<{ listings: MarketListing[]; cursor?: string }>
}
