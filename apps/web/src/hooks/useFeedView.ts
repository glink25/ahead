import { useData } from '../data/local'
import { useMemo, useState, useEffect } from 'react'
import { sourceKey } from '@ahead/protocol'
import { useFeedStore } from '../stores/feed'
import { selectDiscover, selectMine } from '../lib/selectors'
import { marketApi } from '../services/market'
export function useFeedView(marketSeed = 'stable') {
  const { feeds, profile, listings, users, exposures } = useFeedStore()
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
    const resolved = marketApi().events.resolve({
      feeds,
      users: remote,
      activeProfile: profile,
      space,
      now,
      timezone,
    })
    const market = new Set(listings.filter((l) => l.source.resourceType === 'event-feed').map((l) => sourceKey(l.source)))
    return { resolved, discover: selectDiscover(resolved, market, now, marketSeed, exposures), mine: selectMine(resolved, now) }
  }, [feeds, profile, listings, users, exposures, now, space, marketSeed])
}
