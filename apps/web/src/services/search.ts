import { createIdbStore } from '../lib/idb'
import { authenticatedAdapter } from '../lib/auth'
import { useAuthSession } from '../stores'
import { SearchFeedApi } from './search-feed-api'

let current: { identity: string; api: SearchFeedApi } | undefined

/** Identity-scoped, browser-local search provider. */
export function searchFeedApi(): SearchFeedApi | undefined {
  const session = useAuthSession.getState().session
  if (!session) return undefined
  const identity = `${session.providerId}:${session.identity.id}`
  if (current?.identity === identity) return current.api
  const api = new SearchFeedApi({
    adapter: authenticatedAdapter(session),
    cache: createIdbStore(
      'ahead-search-content-' + encodeURIComponent(identity),
      'files',
    ),
  })
  current = { identity, api }
  return api
}
