import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Poster, Countdown, TagChip, IconButton } from '@ahead/ui'
import { sourceKey } from '@ahead/protocol'
import type { Evidence } from '@ahead/schema'
import type { ResolvedEvent } from '@ahead/resolver'
import { useFeedStore } from '../../stores/feed'
import { countdownFor, pickText } from '../../lib/format'
import { posterFor } from '../../lib/media'

export function EvidenceLinks({ evidence }: { evidence?: Evidence[] }) {
  return (
    <div className="evidence-links">
      {evidence
        ?.filter(
          (item) => item.kind === 'url' && /^https?:\/\//u.test(item.value),
        )
        .map((item, index) => (
          <a key={index} href={item.value} target="_blank" rel="noreferrer">
            {pickText(item.label) || '来源'} ↗
          </a>
        ))}
    </div>
  )
}

export function FavoriteButton({ event }: { event: ResolvedEvent }) {
  const { profile, act, ready } = useFeedStore()
  const favorite = profile.favorites?.includes(event.id) ?? false
  return (
    <IconButton
      className="icon-action"
      disabled={!ready}
      aria-label={favorite ? '取消喜爱' : '喜爱'}
      aria-pressed={favorite}
      onClick={() =>
        act({
          type: favorite ? 'unfavorite' : 'favorite',
          id: event.id,
          tags: event.tags,
        })
      }
    >
      {favorite ? '♥' : '♡'}
    </IconButton>
  )
}

export function FeedSourceBar({ event }: { event: ResolvedEvent }) {
  const { feeds, profile, act, ready } = useFeedStore()
  const sources = feeds.filter((f) =>
    event.sourceLocators.includes(f.sourceLocator),
  )
  return (
    <div className="source-list">
      {sources.map((feed) => {
        const source = {
          locator: 'github:' + feed.locator.owner + '/' + feed.locator.repo,
          manifestPath: feed.manifestPath,
          kind: 'event-feed' as const,
        }
        const subscribed = profile.subscriptions?.some(
          (s) => sourceKey(s) === feed.sourceLocator,
        )
        const name = pickText(feed.feed.name)
        return (
          <div className="source-bar" key={feed.sourceLocator}>
            <div>
              <strong>{name}</strong>
            </div>
            <button
              disabled={!ready}
              className={'subscribe ' + (subscribed ? 'subscribed' : '')}
              aria-pressed={Boolean(subscribed)}
              onClick={() =>
                act({ type: subscribed ? 'unsubscribe' : 'subscribe', source })
              }
            >
              {subscribed ? '已订阅' : '订阅频道'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function HideMenu({ event }: { event: ResolvedEvent }) {
  const act = useFeedStore((s) => s.act)
  return (
    <details className="event-menu">
      <summary aria-label="更多事件操作">···</summary>
      <button
        onClick={() => act({ type: 'hide', id: event.id, tags: event.tags })}
      >
        不感兴趣
      </button>
    </details>
  )
}

function EventDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const paragraph = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const element = paragraph.current
    if (!element || expanded) return
    const measure = () =>
      setCanExpand(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, expanded])
  if (!text) return null
  return (
    <div
      className="description-block"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p
        ref={paragraph}
        className={'poster-summary' + (expanded ? ' expanded' : '')}
      >
        {text}
      </p>
      {(canExpand || expanded) && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  )
}

export function PosterCard({
  event,
  index,
}: {
  event: ResolvedEvent
  index: number
}) {
  const { feeds, profile } = useFeedStore()
  const feed = feeds.find((f) => event.sourceLocators.includes(f.sourceLocator))
  const poster = posterFor(event, {
    locator: feed?.locator,
    headSha: feed?.headSha,
    allowRemoteImages: !profile.settings?.privacyRemoteImages,
  })
  const countdown = countdownFor(event)
  return (
    <Poster
      className="poster"
      style={{
        background: 'linear-gradient(145deg,' + poster.gradient.join(',') + ')',
      }}
      aria-label={pickText(event.title)}
    >
      {poster.url && (
        <img
          className="poster-image"
          src={poster.url}
          alt={poster.alt}
          loading={index ? 'lazy' : 'eager'}
          onError={(e) => {
            e.currentTarget.style.opacity = '0'
          }}
        />
      )}
      <div className="poster-shade" />
      <div className="poster-content">
        <div className="poster-main">
          <div className="tag-list">
            {event.tags?.map((tag) => (
              <TagChip key={tag}># {tag}</TagChip>
            ))}
          </div>
          <Link to={'/events/' + encodeURIComponent(event.id)}>
            <h1>{pickText(event.title)}</h1>
          </Link>
          <Countdown className={'countdown ' + countdown.precision}>
            {countdown.headline}
          </Countdown>
          {countdown.dateLabel &&
            !countdown.headline.includes(countdown.dateLabel) && (
              <p className="date-label">{countdown.dateLabel}</p>
            )}
          <EventDescription
            text={pickText(event.summary) || pickText(event.description)}
          />
          <EvidenceLinks evidence={event.evidence} />
        </div>
        <footer>
          <FeedSourceBar event={event} />
          <div className="poster-actions">
            <FavoriteButton event={event} />
            <HideMenu event={event} />
          </div>
        </footer>
      </div>
    </Poster>
  )
}
