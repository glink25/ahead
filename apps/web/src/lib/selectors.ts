import { sourceKey } from '@ahead/protocol'
import { daysUntilEvent, recommend } from '@ahead/recommendation'
import type { ResolvedProfile } from '@ahead/resolver'

export function selectDiscover(profile: ResolvedProfile, marketSources: ReadonlySet<string>, now = new Date()) {
  return recommend({
    events: profile.events.filter((event) => event.sourceLocators.some((source) => marketSources.has(source))),
    profile, now,
  }).map((item) => item.event)
}

export function selectMine(profile: ResolvedProfile, now = new Date()) {
  const sources = new Set((profile.profile.subscriptions ?? []).filter((s) => s.kind !== 'user-data').map(sourceKey))
  const ids = new Set([...profile.favorites, ...profile.pins])
  return profile.events.filter((event) =>
    !profile.hidden.includes(event.id) && event.status !== 'cancelled' && event.status !== 'archived' &&
    (event.sourceLocators.some((s) => s.startsWith('personal:')) || ids.has(event.id) || event.sourceLocators.some((source) => sources.has(source))),
  ).sort((a, b) => {
    const left = daysUntilEvent(a, now) ?? Infinity
    const right = daysUntilEvent(b, now) ?? Infinity
    return (left === right ? 0 : left - right) || a.id.localeCompare(b.id)
  })
}
