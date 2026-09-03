export type MarketResourceType = 'event-feed' | 'user-data'

export interface MarketSourceMetadata {
  schema: 1
  locator: string
  manifestPath?: string
  resourceType: MarketResourceType
}

export interface MarketEntry {
  source: MarketSourceMetadata
  manifest?: string
}
