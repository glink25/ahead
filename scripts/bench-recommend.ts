import { performance } from 'node:perf_hooks'
import { recommend } from '../packages/recommendation/dist/index.js'
import type { ResolvedEvent, ResolvedProfile } from '../packages/resolver/dist/types.js'
import type { UserData } from '../packages/schema/dist/types.js'

function makeEvents(count: number): ResolvedEvent[] {
  const events: ResolvedEvent[] = []
  for (let i = 0; i < count; i += 1) {
    const month = String((i % 12) + 1).padStart(2, '0')
    const d = String((i % 28) + 1).padStart(2, '0')
    const schedule = {
      id: 's1',
      value: { kind: 'exact' as const, date: `2027-${month}-${d}` },
      recordedAt: '2026-01-01T00:00:00Z',
      confidence: 'confirmed' as const,
    }
    events.push({
      id: `event-${i}`,
      title: { 'zh-CN': `事件 ${i}` },
      tags: i % 2 === 0 ? ['games'] : ['holiday'],
      schedule: [schedule],
      currentSchedule: schedule,
      sourceLocators: ['github:bench/feed'],
      provenance: [],
    })
  }
  return events
}

const COUNT = Number(process.env.BENCH_EVENTS ?? 10_000)
const events = makeEvents(COUNT)
const now = '2026-09-03T00:00:00Z'
const user: UserData = {
  oefVersion: '0.1',
  kind: 'user-data',
  id: 'bench',
  displayName: { 'zh-CN': 'Bench' },
}
const profile: ResolvedProfile = {
  id: 'bench',
  profile: user,
  events: [],
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  now,
  favorites: ['event-1', 'event-42'],
  remoteFavorites: { 'event-7': 2 },
  hidden: [],
  pins: [],
  interests: { games: 0.8, holiday: 0.3 },
  subscriptionPriorities: { 'github:bench/feed': 1 },
}

const start = performance.now()
const result = recommend({ events, profile, now })
const elapsed = performance.now() - start

console.log(JSON.stringify({
  events: COUNT,
  recommendations: result.length,
  elapsedMs: Number(elapsed.toFixed(2)),
  thresholdMs: 2000,
  ok: elapsed < 2000,
}, null, 2))

if (elapsed >= 2000) process.exitCode = 1
