import { useEffect, useMemo, useRef, useState } from 'react'
import { useFeedView } from '../../hooks/useFeedView'
import { useFeedStore } from '../../stores/feed'
import { PosterCard } from './PosterCard'

export function DiscoverTab() {
  const { discover } = useFeedView()
  const { loading, refresh } = useFeedStore()
  // Keep the current browsing session stable when a favorite changes ranking.
  const order = useRef<string[]>([])
  const browsing = useRef(false)
  const events = useMemo(() => {
    const map = new Map(discover.map((e) => [e.id, e]))
    const known = new Set(order.current)
    order.current = browsing.current
      ? [...order.current.filter((id) => map.has(id)), ...discover.filter((e) => !known.has(e.id)).map((e) => e.id)]
      : discover.map((event) => event.id)
    return order.current.map((id) => map.get(id)!)
  }, [discover])
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(700)
  const [cursor, setCursor] = useState(0)
  const index = Math.min(cursor, Math.max(0, events.length - 1))
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setHeight(entry.contentRect.height) })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [events.length > 0])
  useEffect(() => {
    const root = container.current
    if (!root) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setCursor(Number((entry.target as HTMLElement).dataset.index))
    }, { root, threshold: .6 })
    root.querySelectorAll('[data-index]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [index, events.length, height])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,button,a,summary') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.max(0, Math.min(events.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
        container.current?.scrollTo({ top: next * height, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
      }
      if (e.key.toLowerCase() === 'f' && events[index]) {
        const event = events[index]!
        const store = useFeedStore.getState()
        store.act({ type: store.profile.favorites?.includes(event.id) ? 'unfavorite' : 'favorite', id: event.id, tags: event.tags })
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [events, index, height])
  if (!events.length) return <div className="empty-view"><span className="empty-orbit">✧</span><h1>{loading ? '正在寻找值得期待的事…' : '这里还没有可用事件'}</h1><p>公开事件源加载后，会出现在这里。</p><button onClick={() => void refresh()} disabled={loading}>重新加载</button></div>
  const from = Math.max(0, index - 2), to = Math.min(events.length, index + 3)
  return <div className="discover-scroll" ref={container} aria-label="发现海报流" onPointerDownCapture={() => { browsing.current = true }}
    onScroll={(e) => { if (e.currentTarget.scrollTop > 0) browsing.current = true; setCursor(Math.round(e.currentTarget.scrollTop / height)) }}>
    <div style={{ height: from * height }} aria-hidden />
    {events.slice(from, to).map((event, offset) => <div className="poster-slot" data-index={from + offset} key={event.id} style={{ height }}>
      <PosterCard event={event} index={from + offset} total={events.length} />
    </div>)}
    <div style={{ height: (events.length - to) * height }} aria-hidden />
  </div>
}
