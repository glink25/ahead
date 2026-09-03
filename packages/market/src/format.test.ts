import { describe, expect, it } from 'vitest'
import {
  parseMarketIssueBody,
  serializeManifestBlock,
  serializeSourceBlock,
} from './format.js'
import type { MarketSourceMetadata } from './types.js'

describe('Market issue format', () => {
  it('round-trips source metadata and a manifest', () => {
    const source: MarketSourceMetadata = {
      schema: 1,
      locator: 'github:owner/events',
      manifestPath: 'ahead.yaml',
      resourceType: 'event-feed',
    }
    const manifest = 'oefVersion: "0.1"\nkind: event-feed'
    const body = [
      'Submitted through Ahead.',
      serializeSourceBlock(source),
      serializeManifestBlock(manifest),
    ].join('\n\n')

    expect(parseMarketIssueBody(body)).toEqual({ source, manifest })
  })

  it('parses a source-only submission', () => {
    const source: MarketSourceMetadata = {
      schema: 1,
      locator: 'github:owner/user-data',
      resourceType: 'user-data',
    }

    expect(parseMarketIssueBody(serializeSourceBlock(source))).toEqual({ source })
  })

  it('returns null for malformed metadata', () => {
    expect(parseMarketIssueBody('<!-- ahead:source:not-json -->')).toBeNull()
  })
})
