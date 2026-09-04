import { useData } from '../data/local'
import { personalEvents } from '../data/model'
import { selectCurrentSchedule } from '@ahead/resolver'
import { useMemo, useState, useEffect } from 'react'
import { resolve } from '@ahead/resolver'
import { sourceKey } from '@ahead/protocol'
import { useFeedStore } from '../stores/feed'
import { selectDiscover, selectMine } from '../lib/selectors'
export function useFeedView() {
  const { feeds, profile, listings, users } = useFeedStore()
  const db = useData((s) => s.db)
  const space = db?.spaces[db.active]
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer) }, [])
  return useMemo(() => {
    const followed = new Set((profile.subscriptions ?? []).filter((s) => s.kind === 'user-data').map(sourceKey))
    // Followed profiles provide votes, not inherited subscriptions or private views.
    const remote = users.filter((u) => followed.has(u.sourceLocator)).map((u) => ({ ...u, user: { ...u.user, subscriptions: [] } }))
    let timezone = profile.settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }) } catch { timezone = 'UTC' }
    const resolved = resolve({ feeds, users: [profile, ...remote], activeProfile: profile, now, timezone })
    if (space) {
      const own = personalEvents(space.records)
      const ids = new Set(own.map((e) => e.id))
      resolved.events = [...resolved.events.filter((e) => !ids.has(e.id)), ...own.map((event) => ({ ...event, currentSchedule: selectCurrentSchedule(event.schedule, now), sourceLocators: ['personal:' + space.id], provenance: [] }))]
    }
    const market = new Set(listings.filter((l) => l.source.resourceType === 'event-feed').map((l) => sourceKey(l.source)))
    return { resolved, discover: selectDiscover(resolved, market, now), mine: selectMine(resolved, now) }
  }, [feeds, profile, listings, users, now, space])
}
