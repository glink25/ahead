import type { ReadEvent } from './market-api'

type Resource = Extract<ReadEvent, { type: 'feed' | 'user' }>
export interface ResourceQuerySnapshot {
  loading: boolean
  refreshing: boolean
  resource?: Resource
  error?: Extract<ReadEvent, { type: 'error' }>
}

/** One observable result and one in-flight read per scoped resource. */
export class ResourceQuery {
  private state: ResourceQuerySnapshot = { loading: true, refreshing: false }
  private listeners = new Set<() => void>()
  private running?: Promise<void>
  private checkedAt = 0
  private invalidated = false
  private closed = false
  private controller?: AbortController
  get active() { return this.listeners.size > 0 || Boolean(this.running) }
  close() { this.closed = true; this.controller?.abort(); this.listeners.clear() }
  revalidate(force = false) { if (this.listeners.size) void this.read(force) }
  constructor(private load: (signal: AbortSignal, refresh: boolean) => AsyncIterable<ReadEvent>, private publish: (event: ReadEvent) => void) {}
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    void this.read()
    return () => { this.listeners.delete(listener) }
  }
  private update(next: ResourceQuerySnapshot) {
    if (this.closed) return
    this.state = next
    this.listeners.forEach((listener) => listener())
  }
  invalidate() {
    this.checkedAt = 0
    if (this.running) this.invalidated = true
    else if (this.listeners.size) void this.read()
  }
  read(refresh = false): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.running) return this.running
    if (!refresh && Date.now() - this.checkedAt < 300_000) return Promise.resolve()
    this.update({ ...this.state, loading: !this.state.resource, refreshing: true })
    this.controller = new AbortController()
    const controller = this.controller
    this.running = (async () => {
      try {
        for await (const event of this.load(controller.signal, refresh)) {
          if (this.closed) return
          if (event.type === 'error') this.update({ ...this.state, loading: false, error: event })
          else this.update({ ...this.state, loading: false, resource: event, error: undefined })
          this.publish(event)
        }
        if (!this.state.error) this.checkedAt = Date.now()
      } catch (error) {
        this.update({ ...this.state, error: { type: 'error', limited: false, reason: 'unavailable', message: String(error) } })
      } finally {
        this.running = undefined
        this.update({ ...this.state, loading: false, refreshing: false })
        if (this.invalidated) {
          this.invalidated = false
          this.invalidate()
        }
      }
    })()
    return this.running
  }
  async *stream(refresh = false, signal?: AbortSignal): AsyncGenerator<ReadEvent> {
    const queue: ReadEvent[] = []
    let wake: (() => void) | undefined
    let previous = this.state
    if (previous.resource) queue.push(previous.resource)
    const receive = () => {
      if (this.state.resource && this.state.resource !== previous.resource) queue.push(this.state.resource)
      if (this.state.error && this.state.error !== previous.error) queue.push(this.state.error)
      previous = this.state
      wake?.()
    }
    this.listeners.add(receive)
    let complete = false
    const pending = this.read(refresh).finally(() => { complete = true; wake?.() })
    const aborted = () => wake?.()
    signal?.addEventListener('abort', aborted)
    try {
      while (!signal?.aborted) {
        while (queue.length && !signal?.aborted) yield queue.shift()!
        if (complete) break
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(receive)
      signal?.removeEventListener('abort', aborted)
      // Detaching a reader never cancels another reader's shared request.
      void pending
    }
  }
}
