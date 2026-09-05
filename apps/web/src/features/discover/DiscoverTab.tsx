import { useTranslation } from 'react-i18next'
import { LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFeedView } from '../../hooks/useFeedView'
import { useFeedStore } from '../../stores/feed'
import { PosterCard } from './PosterCard'

export function DiscoverTab({ active = true }: { active?: boolean }) {
  const { t } = useTranslation()

  const { discover } = useFeedView()
  const { loading, refresh, marketStatus, revision, setMarketActive } =
    useFeedStore()
  useEffect(() => {
    const update = () =>
      setMarketActive(active && document.visibilityState === 'visible')
    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      setMarketActive(false)
    }
  }, [active, setMarketActive])
  // Keep the current browsing session stable when a favorite changes ranking.
  const order = useRef<string[]>([])
  const browsing = useRef(false)
  const previousRevision = useRef(revision)
  const events = useMemo(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision
      order.current = []
      browsing.current = false
    }
    const map = new Map(discover.map((e) => [e.id, e]))
    const known = new Set(order.current)
    order.current = browsing.current
      ? [
          ...order.current.filter((id) => map.has(id)),
          ...discover.filter((e) => !known.has(e.id)).map((e) => e.id),
        ]
      : discover.map((event) => event.id)
    if (order.current.length) browsing.current = true
    return order.current.map((id) => map.get(id)!)
  }, [discover, revision])
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(700)
  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  useLayoutEffect(() => {
    if (active && container.current) {
      const size = container.current.clientHeight
      if (size > 0) {
        setHeight(size)
        container.current.scrollTop = cursorRef.current * size
      }
    }
  }, [active])
  const index = Math.min(cursor, Math.max(0, events.length - 1))
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.height > 0 && activeRef.current) {
        const size = entry.contentRect.height
        setHeight(size)
        container.current?.scrollTo({
          top: cursorRef.current * size,
          behavior: 'instant',
        })
      }
    })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [events.length > 0])
  useEffect(() => {
    const root = container.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting && activeRef.current) {
            const next = Number((entry.target as HTMLElement).dataset.index)
            cursorRef.current = next
            setCursor(next)
          }
      },
      { root, threshold: 0.6 },
    )
    root
      .querySelectorAll('[data-index]')
      .forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [index, events.length, height])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (!active) return
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,button,a,summary',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.max(
          0,
          Math.min(events.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)),
        )
        container.current?.scrollTo({
          top: next * height,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        })
      }
      if (e.key.toLowerCase() === 'f' && events[index]) {
        const event = events[index]!
        const store = useFeedStore.getState()
        store.act({
          type: store.profile.favorites?.includes(event.id)
            ? 'unfavorite'
            : 'favorite',
          id: event.id,
          tags: event.tags,
        })
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [events, index, height, active])
  if (!events.length && loading)
    return (
      <div className="empty-view" role="status" aria-label={t('messages.loading_2')}>
        <LoaderCircle className="loading-spinner" />
      </div>
    )
  if (!events.length)
    return (
      <div className="empty-view">
        <span className="empty-orbit"><Sparkles /></span>
        <h1>
          {marketStatus === 'failed' ? t('messages.content_is_temporarily_unavailable') : t('messages.no_events_yet')}
        </h1>
        <button onClick={() => void refresh()} disabled={loading}>
           {t('messages.reload')} </button>
      </div>
    )
  const from = Math.max(0, index - 2),
    to = Math.min(events.length, index + 3)
  return (
    <div
      className="discover-scroll"
      ref={container}
      aria-label={t('messages.discover_events')}
      onPointerDownCapture={() => {
        browsing.current = true
      }}
      onScroll={(e) => {
        if (!active) return
        if (e.currentTarget.scrollTop > 0) browsing.current = true
        const next = Math.round(e.currentTarget.scrollTop / height)
        cursorRef.current = next
        setCursor(next)
      }}
    >
      <div style={{ height: from * height }} aria-hidden />
      {events.slice(from, to).map((event, offset) => (
        <div
          className="poster-slot"
          data-index={from + offset}
          key={event.id}
          style={{ height }}
        >
          <PosterCard event={event} index={from + offset} />
        </div>
      ))}
      <div style={{ height: (events.length - to) * height }} aria-hidden />
    </div>
  )
}
