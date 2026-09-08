import type { RepositoryAdapter, RepositorySnapshot, VersionedFile } from '@ahead/core'
import type { GitHubSearchAdapter } from '@ahead/github'
import { parseYaml, sourceKey } from '@ahead/protocol'
import {
  createValidator,
  type Event,
  type EventFeed,
} from '@ahead/schema'
import { assertDurationFitsRecurrence } from '@ahead/resolver'
import {
  assertEventFeed,
  matchesEventsGlob,
  type LoadedFeed,
} from '../lib/feed-loader'
import { isAbort } from '../services/public-read-client'

import type { SearchErrorReason, SearchFeedEvent, SearchFeedStatus, SearchRequest, SearchFeedSession, SearchProvider } from '../services/search-feed-api'
type Adapter = Omit<RepositoryAdapter, 'inspect' | 'readFile'> & GitHubSearchAdapter & {
  inspect(locator: Parameters<RepositoryAdapter['inspect']>[0], options?: { signal?: AbortSignal }): ReturnType<RepositoryAdapter['inspect']>
  readFile(
    locator: Parameters<RepositoryAdapter['readFile']>[0],
    path: string,
    options?: { ref?: string; signal?: AbortSignal },
  ): ReturnType<RepositoryAdapter['readFile']>
}
type Candidate = { path: string; repository: { name: string; owner: { login: string } } }
type SessionState = {
  page: number
  complete: boolean
  active: boolean
  closed: boolean
  loadRequested: boolean
  loading?: Promise<void>
  controller?: AbortController
  seenFiles: Set<string>
  feeds: Map<string, LoadedFeed>
  snapshots: Map<string, Promise<RepositorySnapshot>>
  manifests: Map<string, Promise<{ path: string; feed: EventFeed; cached: boolean }[]>>
  eventKeys: Set<string>
}

const validator = createValidator()
const PAGE_SIZE = 100
const MAX_PAGES = 10
const LOAD_AHEAD = 3

/** Browser-local search orchestration. Only code discovery may use a relay. */
export class GitHubSearchProvider implements SearchProvider {
  constructor(private readonly options: {
    adapter: Adapter
    search?: GitHubSearchAdapter
  }) {}

  private get search() {
    return this.options.search ?? this.options.adapter
  }

  openSession(options: {
    request: SearchRequest
    receive: (event: SearchFeedEvent) => void
    status: (status: SearchFeedStatus) => void
  }): SearchFeedSession {
    const request = normalizeRequest(options.request)
    const state: SessionState = {
      page: 1,
      complete: false,
      active: false,
      closed: false,
      loadRequested: false,
      seenFiles: new Set(),
      feeds: new Map(),
      snapshots: new Map(),
      manifests: new Map(),
      eventKeys: new Set(),
    }

    const load = async () => {
      if (state.closed || state.complete) return
      if (state.loading) {
        state.loadRequested = true
        return state.loading
      }
      state.loadRequested = false
      const controller = new AbortController()
      state.controller = controller
      options.status('searching')
      const run = (async () => {
        try {
          let delivered = 0
          do {
            const page = state.page
            const result = await this.search.searchCode(
              buildCodeQuery(request), page, PAGE_SIZE, controller.signal,
            )
            if (controller.signal.aborted || state.closed) return
            if (result.incomplete_results) options.receive(incompleteError())
            for (const candidate of result.items) {
              if (controller.signal.aborted || state.closed) return
              delivered += await this.consumeCandidate(candidate, request, state, options.receive, controller.signal)
            }
            const hasNext = page < MAX_PAGES && page * PAGE_SIZE < result.total_count
            state.page = page + 1
            state.complete = !hasNext
            // Invalid/stale candidates must not strand an apparently empty result page.
          } while (!state.complete && delivered === 0)
          options.receive({ type: 'progress', loaded: state.eventKeys.size, complete: state.complete })
          options.status(state.complete ? 'complete' : 'paused')
        } catch (error) {
          if (isAbort(error) || controller.signal.aborted || state.closed) return
          options.receive(searchError(error))
          options.status('failed')
        } finally {
          if (state.controller === controller) state.controller = undefined
          state.loading = undefined
          if (state.active && state.loadRequested && !state.complete) void load()
        }
      })()
      state.loading = run
      return run
    }

    return {
      setActive(active) {
        state.active = active
        if (active) void load()
        else state.controller?.abort()
      },
      reportVisible(index, available) {
        if (state.active && !state.complete && index >= Math.max(0, available - LOAD_AHEAD))
          void load()
      },
      async retry() {
        if (state.closed) return
        await load()
      },
      close() {
        state.closed = true
        state.controller?.abort()
      },
    }
  }

  private async consumeCandidate(
    candidate: Candidate,
    request: SearchRequest,
    state: SessionState,
    receive: (event: SearchFeedEvent) => void,
    signal: AbortSignal,
  ): Promise<number> {
    const owner = candidate.repository.owner.login
    const repo = candidate.repository.name
    const fileKey = `${owner}/${repo}:${candidate.path}`.toLowerCase()
    if (state.seenFiles.has(fileKey)) return 0
    state.seenFiles.add(fileKey)
    try {
      const snapshot = await this.snapshot(owner, repo, state, signal)
      const file = await this.readFile(owner, repo, candidate.path, snapshot, signal)
      const document = parseYaml<unknown>(file.file.content)
      if (isMarkedFeed(document)) {
        const feed = assertEventFeed(document, validator, `github:${owner}/${repo}`)
        const events = (feed.events ?? []).filter((event) => matchesRequest(event, request))
        if (!events.length) return 0
        return this.deliver({
          sourceLocator: sourceKey({ locator: `github:${owner}/${repo}`, manifestPath: candidate.path }),
          manifestPath: candidate.path,
          version: snapshot.headSha,
          private: snapshot.private,
          complete: false,
          feed: { ...feed, events },
        }, file.cached, state, receive)
      }
      if (!isMarkedEvent(document) || !validator.validate('event', document).ok) return 0
      const event = document as Event
      assertDurationFitsRecurrence(event.duration, event.recurrence)
      if (!matchesRequest(event, request)) return 0
      const manifests = await this.manifestPaths(owner, repo, snapshot, state, receive, signal)
      let delivered = 0
      for (const manifest of manifests) {
        if (!matchesEventsGlob(candidate.path, manifest.feed.eventsGlob)) continue
        delivered += this.deliver({
          sourceLocator: sourceKey({ locator: `github:${owner}/${repo}`, manifestPath: manifest.path }),
          manifestPath: manifest.path,
          version: snapshot.headSha,
          private: snapshot.private,
          complete: false,
          feed: { ...manifest.feed, events: [event] },
        }, file.cached && manifest.cached, state, receive)
      }
      return delivered
    } catch (error) {
      if (isFatalRequestError(error)) throw error
      // Search hits are untrusted and can be stale or invalid.
      return 0
    }
  }

  private deliver(
    next: LoadedFeed,
    cached: boolean,
    state: SessionState,
    receive: (event: SearchFeedEvent) => void,
  ) {
    const previous = state.feeds.get(next.sourceLocator)
    const events = [...new Map([
      ...(previous?.feed.events ?? []),
      ...(next.feed.events ?? []),
    ].map((event) => [event.id, event])).values()]
    const feed = { ...next, feed: { ...next.feed, events } }
    state.feeds.set(next.sourceLocator, feed)
    const before = state.eventKeys.size
    for (const event of next.feed.events ?? [])
      state.eventKeys.add(`${next.sourceLocator}\0${event.id}`)
    receive({ type: 'feed', feed, cached })
    return state.eventKeys.size - before
  }

  private snapshot(owner: string, repo: string, state: SessionState, signal: AbortSignal): Promise<RepositorySnapshot> {
    const key = `${owner}/${repo}`.toLowerCase()
    const existing = state.snapshots.get(key)
    if (existing) return existing
    const created = this.options.adapter.inspect({ scheme: 'github', owner, repo }, { signal })
    state.snapshots.set(key, created)
    return created
  }

  private async readFile(
    owner: string,
    repo: string,
    path: string,
    snapshot: RepositorySnapshot,
    signal: AbortSignal,
  ): Promise<{ file: VersionedFile; cached: boolean }> {
    if (signal.aborted) throw new DOMException('Request aborted', 'AbortError')
    const file = await this.options.adapter.readFile(
      { scheme: 'github', owner, repo }, path, { ref: snapshot.headSha, signal },
    )
    return { file, cached: false }
  }

  private manifestPaths(
    owner: string,
    repo: string,
    snapshot: RepositorySnapshot,
    state: SessionState,
    receive: (event: SearchFeedEvent) => void,
    signal: AbortSignal,
  ) {
    const key = `${owner}/${repo}@${snapshot.headSha}`.toLowerCase()
    let manifests = state.manifests.get(key)
    if (!manifests) {
      manifests = (async () => {
        const query = `\"event-feed\" \"oefVersion\" repo:${owner}/${repo} in:file`
        const found = await this.search.searchCode(query, 1, PAGE_SIZE, signal)
        if (found.incomplete_results) receive(incompleteError())
        const values: { path: string; feed: EventFeed; cached: boolean }[] = []
        for (const item of found.items) {
          try {
            const loaded = await this.readFile(owner, repo, item.path, snapshot, signal)
            const document = parseYaml<unknown>(loaded.file.content)
            if (!validator.validate('event-feed', document).ok) continue
            values.push({
              path: item.path,
              feed: assertEventFeed(document, validator, `github:${owner}/${repo}`),
              cached: loaded.cached,
            })
          } catch (error) {
            if (isFatalRequestError(error)) throw error
          }
        }
        return values
      })()
      state.manifests.set(key, manifests)
    }
    return manifests
  }
}

function normalizeRequest(request: SearchRequest): SearchRequest {
  if ('tag' in request && request.tag !== undefined) {
    const tag = request.tag.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(tag)) throw new Error('messages.invalid_tag')
    return { tag }
  }
  const query = request.query.normalize('NFKC').trim()
  if (!query) throw new Error('messages.search_query_is_empty')
  return { query }
}

function quote(term: string) {
  return `\"${term.replace(/["\\]/gu, '\\$&')}\"`
}

export function buildCodeQuery(request: SearchRequest) {
  const terms = 'tag' in request && request.tag !== undefined
    ? [request.tag, 'tags']
    : [...request.query!.split(/\s+/u), 'schedule']
  return [...terms, 'oefSearch', 'oef-search-v1'].map(quote).join(' ') + ' in:file'
}

function matchesRequest(event: Event, request: SearchRequest) {
  if ('tag' in request && request.tag !== undefined)
    return event.tags?.some((tag) => tag.toLowerCase() === request.tag) ?? false
  const text = [
    ...Object.values(event.title),
    ...Object.values(event.summary ?? {}),
    ...Object.values(event.description ?? {}),
    ...(event.tags ?? []),
  ].join('\n').normalize('NFKC').toLocaleLowerCase()
  return request.query!.toLocaleLowerCase().split(/\s+/u).every((term) => text.includes(term))
}

function isMarkedFeed(value: unknown): value is EventFeed {
  return !!value && typeof value === 'object' &&
    (value as { oefSearch?: unknown }).oefSearch === 'oef-search-v1' &&
    (value as { kind?: unknown }).kind === 'event-feed'
}

function isMarkedEvent(value: unknown): value is Event {
  return !!value && typeof value === 'object' &&
    (value as { oefSearch?: unknown }).oefSearch === 'oef-search-v1' &&
    (value as { kind?: unknown }).kind !== 'event-feed'
}

function statusOf(error: unknown) {
  return typeof error === 'object' && error !== null &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : 0
}

function isFatalRequestError(error: unknown) {
  const status = statusOf(error)
  return status === 401 || status === 429 ||
    (status === 403 && /rate limit|abuse|secondary rate/iu.test(String(error))) ||
    isAbort(error)
}

function searchError(error: unknown): SearchFeedEvent & { type: 'error' } {
  const status = statusOf(error)
  const limited = status === 429 ||
    (status === 403 && /rate limit|abuse|secondary rate/iu.test(String(error)))
  const unauthenticated = status === 401 ||
    (typeof error === 'object' && error !== null &&
      (error as { kind?: unknown }).kind === 'unauthenticated') ||
    /no github .*token|no github .*credential|token .*expired|access token is unavailable/iu.test(String(error))
  const reason: SearchErrorReason = unauthenticated
    ? 'authentication-expired'
    : limited
      ? 'rate-limited'
      : 'search-unavailable'
  return {
    type: 'error',
    reason,
    limited,
    message: reason === 'authentication-expired'
      ? 'messages.github_sign_in_expired'
      : reason === 'rate-limited'
        ? 'messages.github_search_rate_limited'
        : `messages.github_search_unavailable：${String(error)}`,
  }
}

function incompleteError(): SearchFeedEvent & { type: 'error' } {
  return {
    type: 'error',
    message: 'messages.github_search_results_incomplete',
    reason: 'incomplete-results',
    limited: false,
  }
}
