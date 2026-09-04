export type MarketResourceType = 'event-feed' | 'user-data'

export interface MarketSourceMetadata {
  schema: 1
  locator: string
  manifestPath?: string
  resourceType: MarketResourceType
  name?: Record<string, string>
  description?: Record<string, string>
  tags?: string[]
  validatedSha?: string
  validatedAt?: string
}

export interface MarketEntry {
  source: MarketSourceMetadata
  manifest?: string
}
