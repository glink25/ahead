import type { KeyValueStore } from '../lib/idb'

export const READ_POLICY = {
  ttl: 10 * 60_000,
  apiInterval: 1000,
  contentConcurrency: 4,
}
interface CachedResponse {
  body: string
  headers: [string, string][]
  status: number
  storedAt: number
}
export class PublicReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly authenticated: boolean,
    readonly limited = false,
    readonly retryAt?: number,
    readonly remaining?: number,
  ) {
    super(message)
    this.name = 'PublicReadError'
  }
}
export function abortError() {
  return new DOMException('Request aborted', 'AbortError')
}
export function isAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const done = () => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }
    const timer = setTimeout(done, ms)
    const cancel = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      reject(abortError())
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
}
function restore(value: CachedResponse) {
  return new Response(value.body, {
    status: value.status,
    headers: value.headers,
  })
}
interface Pending {
  promise: Promise<CachedResponse>
  controller: AbortController
  readers: number
}

/** Private transport of the browser-side service. No credentials are persisted. */
export class PublicReadClient {
  private memory = new Map<string, CachedResponse>()
  private pending = new Map<string, Pending>()
  private apiQueue: {
    priority: number
    run: () => Promise<CachedResponse>
    resolve: (value: CachedResponse) => void
    reject: (error: unknown) => void
  }[] = []
  private apiRunning = false
  private lastApiStart = 0
  private contentActive = 0
  private blocked?: PublicReadError
  constructor(
    private options: {
      fetcher: typeof fetch
      store: KeyValueStore
      authenticated: boolean
      apiInterval?: number
      now?: () => number
    },
  ) {}
  private now() {
    return this.options.now?.() ?? Date.now()
  }

  fetch(
    context: {
      refresh?: boolean
      signal?: AbortSignal
      priority?: number
    } = {},
  ): typeof fetch {
    const refreshAt = context.refresh ? this.now() : undefined
    return async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      if (method.toUpperCase() !== 'GET')
        throw new TypeError('PublicReadClient only supports GET requests')
      const signal =
        init?.signal ??
        context.signal ??
        (input instanceof Request ? input.signal : undefined)
      if (signal?.aborted) throw abortError()
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      )
      const key = url + '|' + (headers.get('accept') ?? '')
      const cached =
        this.memory.get(key) ??
        (await this.options.store
          .get<CachedResponse>(key)
          .catch(() => undefined))
      if (signal?.aborted) throw abortError()
      const immutable = /(?:@|\/)[a-f0-9]{40}(?:\/|\?)/i.test(url)
      if (
        cached &&
        (immutable ||
          (this.now() - cached.storedAt < READ_POLICY.ttl &&
            (refreshAt === undefined || cached.storedAt >= refreshAt)))
      )
        return restore(cached)
      let pending = this.pending.get(key)
      if (!pending || pending.controller.signal.aborted) {
        const controller = new AbortController()
        const current: Pending = {
          controller,
          readers: 0,
          promise: Promise.resolve(null as unknown as CachedResponse),
        }
        current.promise = this.request(
          url,
          headers,
          cached,
          controller.signal,
          context.priority ?? 0,
        )
          .then(async (value) => {
            this.memory.set(key, value)
            await this.options.store.set(key, value).catch(() => {})
            return value
          })
          .finally(() => {
            if (this.pending.get(key) === current) this.pending.delete(key)
          })
        this.pending.set(key, current)
        pending = current
      }
      const request = pending
      request.readers++
      return new Promise<Response>((resolve, reject) => {
        let settled = false
        const finish = () => {
          if (settled) return false
          settled = true
          signal?.removeEventListener('abort', cancel)
          if (--request.readers === 0) request.controller.abort()
          return true
        }
        const cancel = () => {
          if (finish()) reject(abortError())
        }
        signal?.addEventListener('abort', cancel, { once: true })
        request.promise.then(
          (value) => {
            if (finish()) resolve(restore(value))
          },
          (error) => {
            if (finish()) reject(error)
          },
        )
        if (signal?.aborted) cancel()
      })
    }
  }

  private async drainApi() {
    if (this.apiRunning) return
    this.apiRunning = true
    try {
      while (this.apiQueue.length) {
        const task = this.apiQueue.shift()!
        try {
          task.resolve(await task.run())
        } catch (error) {
          task.reject(error)
        }
      }
    } finally {
      this.apiRunning = false
    }
  }

  private async request(
    url: string,
    headers: Headers,
    cached: CachedResponse | undefined,
    signal: AbortSignal,
    priority: number,
  ): Promise<CachedResponse> {
    const api = new URL(url).origin === 'https://api.github.com'
    const run = async () => {
      if (signal.aborted) throw abortError()
      if (api) {
        if (this.blocked && this.now() < this.blocked.retryAt!)
          throw this.blocked
        await sleep(
          Math.max(
            0,
            this.lastApiStart +
              (this.options.apiInterval ?? READ_POLICY.apiInterval) -
              this.now(),
          ),
          signal,
        )
        this.lastApiStart = this.now()
      }
      if (cached) {
        const etag = new Headers(cached.headers).get('etag')
        if (etag) headers.set('If-None-Match', etag)
      }
      const response = await this.options.fetcher(url, {
        headers,
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })
      if (response.status === 304 && cached) {
        const merged = new Headers(cached.headers)
        response.headers.forEach((value, name) => merged.set(name, value))
        return {
          ...cached,
          headers: [...merged.entries()],
          storedAt: this.now(),
        }
      }
      const body = await response.text()
      if (!response.ok) {
        let detail = body.slice(0, 400)
        try {
          detail = (JSON.parse(body) as { message?: string }).message ?? detail
        } catch {
          /* non-JSON error */
        }
        const remainingHeader = response.headers.get('x-ratelimit-remaining')
        const remaining =
          remainingHeader === null ? undefined : Number(remainingHeader)
        const limited =
          api &&
          (response.status === 429 ||
            (response.status === 403 &&
              (remaining === 0 ||
                response.headers.has('retry-after') ||
                /rate limit|abuse detection/i.test(detail))))
        const retry = response.headers.get('retry-after')
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
        const retryAt = limited
          ? Math.max(
              this.now() + 60_000,
              retry
                ? Number.isFinite(Number(retry))
                  ? this.now() + Number(retry) * 1000
                  : Date.parse(retry) || 0
                : 0,
              remaining === 0 && Number.isFinite(reset) ? reset : 0,
            )
          : undefined
        const message =
          `HTTP ${response.status}：${detail || response.statusText}` +
          (limited
            ? (this.options.authenticated
                ? '。GitHub 请求额度受限'
                : '。GitHub 访问受限，登录可提高请求额度') +
              `，可于 ${new Date(retryAt!).toLocaleTimeString()} 后重试`
            : '')
        const error = new PublicReadError(
          message,
          response.status,
          this.options.authenticated,
          limited,
          retryAt,
          remaining,
        )
        if (limited) this.blocked = error
        throw error
      }
      return {
        body,
        status: response.status,
        headers: [...response.headers.entries()],
        storedAt: this.now(),
      }
    }
    if (api) {
      return new Promise<CachedResponse>((resolve, reject) => {
        this.apiQueue.push({ priority, run, resolve, reject })
        this.apiQueue.sort((a, b) => b.priority - a.priority)
        queueMicrotask(() => {
          void this.drainApi()
        })
      })
    }
    while (this.contentActive >= READ_POLICY.contentConcurrency)
      await sleep(20, signal)
    this.contentActive++
    try {
      return await run()
    } finally {
      this.contentActive--
    }
  }
}
