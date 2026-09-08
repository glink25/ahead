import { parseLocator, parseSourceKey, sourceKey } from '@ahead/protocol'
import type { Subscription } from '@ahead/schema'
import { recordKey, type Space, type Target } from '@ahead/sync'

export type ResourceAddress =
  | { scheme: 'local'; spaceId: string }
  | { scheme: 'remote'; locator: string; manifestPath?: string }

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

export function remoteAddress(source: Pick<Subscription, 'locator' | 'manifestPath'>): ResourceAddress {
  const normalized = parseSourceKey(sourceKey(source))
  return { scheme: 'remote', ...normalized }
}

export function addressFromSourceKey(key: string): ResourceAddress {
  return remoteAddress(parseSourceKey(key))
}

export function addressFromTarget(target: Target): ResourceAddress {
  return remoteAddress({
    locator: target.locator,
    manifestPath: target.path,
  })
}

export function sourceFromAddress(
  address: Extract<ResourceAddress, { scheme: 'remote' }>,
  kind: 'event-feed' | 'user-data',
): Subscription {
  return {
    locator: address.locator,
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
  const parsed = parseLocator(address.locator)
  if (parsed.scheme === 'github' && 'owner' in parsed)
    return `${prefix}/github/${segment(parsed.owner)}/${segment(parsed.repo)}${path}`
  return `${prefix}/source/${localSegment(address.locator)}${path}`
}

export function eventPath(event: { id: string; address: ResourceAddress }) {
  return resourcePath('event', event.address, event.id)
}

export function parseResourceAddress(value: string | undefined): ResourceAddress {
  const parts = (value ?? '').split('/').filter(Boolean)
  if (parts[0] === 'local' && parts.length === 2 && parts[1])
    return { scheme: 'local', spaceId: parseLocalSegment(parts[1]) }
  if (parts[0] === 'source' && parts[1]) return remoteAddress({ locator: parseLocalSegment(parts[1]), ...(parts.length > 2 ? { manifestPath: parts.slice(2).join('/') } : {}) })
  if (parts[0] !== 'github' || parts.length < 3 || !parts[1] || !parts[2])
    throw new TypeError('Invalid resource address')
  return remoteAddress({
    locator: `github:${parts[1]}/${parts[2]}`,
    ...(parts.length > 3 ? { manifestPath: parts.slice(3).join('/') } : {}),
  })
}

export function localEventAddress(space: Space, eventId: string): ResourceAddress {
  return space.feed?.version && Boolean(space.baseRecords[recordKey('events', eventId)])
    ? addressFromTarget(space.feed)
    : { scheme: 'local', spaceId: space.id }
}

export function localFeedAddress(space: Space): ResourceAddress {
  return space.feed?.version ? addressFromTarget(space.feed) : { scheme: 'local', spaceId: space.id }
}

export function localUserAddress(space: Space): ResourceAddress {
  return space.remote?.version ? addressFromTarget(space.remote) : { scheme: 'local', spaceId: space.id }
}
