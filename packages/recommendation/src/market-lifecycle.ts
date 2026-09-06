import type { ResolvedEvent } from '@ahead/resolver'
import { daysUntilEvent, eventEndedAt } from './score.js'
import type { EventLifecycle } from './market-types.js'

const DAY = 86_400_000

export function classifyLifecycle(
  event: ResolvedEvent,
  now: Date | string,
  recentPastDays = 7,
): EventLifecycle {
  const endedAt = eventEndedAt(event, now)
  if (endedAt) {
    const age = (new Date(now).getTime() - endedAt.getTime()) / DAY
    return age <= recentPastDays ? 'recent-past' : 'expired'
  }
  const days = daysUntilEvent(event, now)
  if (days === null) return 'unknown'
  return days <= 0 ? 'current' : 'future'
}
