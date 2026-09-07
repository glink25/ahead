import { manifestPath, parseLocator, parseSourceKey, sourceKey } from '@ahead/protocol'
import type { Subscription } from '@ahead/schema'
import type { Space, Target } from '@ahead/sync'

export type ResourceAddress =
  | { scheme: 'local'; spaceId: string }
  | {
      scheme: 'github'
      owner: string
      repo: string
      manifestPath?: string
    }

export type ResourceKind = 'event' | 'event-feed' | 'user-data'

const roots: Record<ResourceKind, string> = {
  event: 'events',
  'event-feed': 'channels',
  'user-data': 'people',
}

function segment(value: string) {
  return encodeURIComponent(value)
}

function localSegment(value: string) {
  if (/^[A-Za-z0-9._:-]+$/u.test(value)) return value
  const bytes = new TextEncoder().encode(value)
  return '~' + btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function parseLocalSegment(value: string) {
  if (!value.startsWith('~')) return value
  const encoded = value.slice(1).replaceAll('-', '+').replaceAll('_', '/')
  const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4)
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function githubAddress(source: Pick<Subscription, 'locator' | 'manifestPath'>): ResourceAddress {
  const locator = parseLocator(source.locator)
  if (locator.scheme !== 'github' || !('owner' in locator))
    throw new TypeError('Unsupported resource address')
  const path = manifestPath(source.manifestPath)
  return {
    scheme: 'github',
    owner: locator.owner.toLowerCase(),
    repo: locator.repo.toLowerCase(),
    ...(path === 'ahead.yaml' ? {} : { manifestPath: path }),
  }
}

export function addressFromSourceKey(key: string): ResourceAddress {
  return githubAddress(parseSourceKey(key))
}

export function addressFromTarget(target: Target): ResourceAddress {
  return githubAddress({
    locator: `github:${target.owner}/${target.repo}`,
    manifestPath: target.path,
  })
}

export function sourceFromAddress(
  address: Extract<ResourceAddress, { scheme: 'github' }>,
  kind: 'event-feed' | 'user-data',
): Subscription {
  return {
    locator: `github:${address.owner}/${address.repo}`,
    ...(address.manifestPath ? { manifestPath: address.manifestPath } : {}),
    kind,
  }
}

export function addressKey(address: ResourceAddress): string {
  return address.scheme === 'local'
    ? `local:${address.spaceId}`
    : sourceKey(sourceFromAddress(address, 'event-feed'))
}

export function resourcePath(
  kind: ResourceKind,
  address: ResourceAddress,
  eventId?: string,
): string {
  const prefix = `/${roots[kind]}` + (kind === 'event' ? `/${segment(eventId ?? '')}` : '')
  if (address.scheme === 'local') return `${prefix}/local/${localSegment(address.spaceId)}`
  const path = address.manifestPath
    ? '/' + address.manifestPath.split('/').map(segment).join('/')
    : ''
  return `${prefix}/github/${segment(address.owner)}/${segment(address.repo)}${path}`
}

export function eventPath(event: { id: string; address: ResourceAddress }) {
  return resourcePath('event', event.address, event.id)
}

export function parseResourceAddress(value: string | undefined): ResourceAddress {
  const parts = (value ?? '').split('/').filter(Boolean)
  if (parts[0] === 'local' && parts.length === 2 && parts[1])
    return { scheme: 'local', spaceId: parseLocalSegment(parts[1]) }
  if (parts[0] !== 'github' || parts.length < 3 || !parts[1] || !parts[2])
    throw new TypeError('Invalid resource address')
  return githubAddress({
    locator: `github:${parts[1]}/${parts[2]}`,
    ...(parts.length > 3 ? { manifestPath: parts.slice(3).join('/') } : {}),
  })
}

function pendingEvent(space: Space, eventId: string) {
  const record = Object.values(space.records).find(
    (item) => item.collection === 'events' && item.key === eventId && !item.deleted,
  )
  return !record || space.pending.includes(record.operation)
}

export function localEventAddress(space: Space, eventId: string): ResourceAddress {
  return space.feed && !pendingEvent(space, eventId)
    ? addressFromTarget(space.feed)
    : { scheme: 'local', spaceId: space.id }
}

export function localFeedAddress(space: Space): ResourceAddress {
  const pending = new Set(space.pending)
  const feedPending = Object.values(space.records).some(
    (item) => ['events', 'feed'].includes(item.collection) && pending.has(item.operation),
  )
  return space.feed && !feedPending
    ? addressFromTarget(space.feed)
    : { scheme: 'local', spaceId: space.id }
}

export function localUserAddress(space: Space): ResourceAddress {
  const pending = new Set(space.pending)
  const profilePending = Object.values(space.records).some(
    (item) => !['events', 'feed'].includes(item.collection) && pending.has(item.operation),
  )
  return space.remote && !profilePending
    ? addressFromTarget(space.remote)
    : { scheme: 'local', spaceId: space.id }
}
