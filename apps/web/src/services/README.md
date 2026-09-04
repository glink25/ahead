# Browser-side market API

UI and stores use `marketApi()` from `market.ts`. This is an in-process business API, not an HTTP server. Do not call GitHub, manage ETags, or open feed caches from a UI component.

```ts
const api = marketApi()
for await (const event of api.market.stream({ cursor, signal })) {
  // Merge feed/user updates by sourceLocator; append listings by sourceKey.
  // Save progress.cursor for pause/resume within this service session.
}
```

- `market.snapshot()` returns previously seen market listings without networking.
- `sources.snapshot(sources)` yields validated locally cached feeds/profiles.
- `relatedSources(profile)` resolves subscriptions plus known sources containing favorite/pinned event IDs, using local data only.
- `sources.read({ sources, signal, refresh })` streams explicit public source reads.
- `market.stream({ cursor, signal, refresh })` streams discovery. Stop consumption using the signal when discovery is hidden. Resume using the last cursor; re-delivery is allowed and must be merged idempotently.
- Omit the cursor to start a new traversal. `refresh: true` revalidates mutable data while retaining immutable content. A cursor is in-memory and scoped to one service identity, not a portable bookmark.
- `listings` updates during traversal are cumulative but not authoritative for removals until `progress.complete`. A cached snapshot may include delisted sources until a complete traversal reconciles it.
- A normal source error does not stop other sources. A page failure or rate limit ends the stream. Errors remain visible even if cached content is available. An explicit retry resumes an interrupted traversal; a completed traversal with source errors can be restarted to retry those sources.

The service owns parsing, SHA-pinned feed expansion, persistence and cache policy. `PublicReadClient` is its internal transport: 10-minute mutable TTL, ETag revalidation, immutable SHA caching, request coalescing, serial GitHub requests at least one second apart, and at most four content requests. Signal cancellation detaches a reader; shared requests remain alive for other readers. Queued requests with no readers are discarded.

API tokens are supplied by the application auth provider only for the GitHub API origin. HTTP response caches and limiter state are identity-scoped. Read-through access to the old public-only feed stores preserves offline data from existing installations; new writes use the scoped stores. No private-sync or write requests use this cache.

The limiter is local to this client instance. It cannot coordinate other browser tabs, devices, applications, or users behind the same anonymous IP. Rate-limit responses block further network API requests until their recovery time and are not retried automatically. A fresh cache hit is still usable during that interval.
