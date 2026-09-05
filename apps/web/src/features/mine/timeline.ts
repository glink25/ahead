import { eventEndedAt } from '@ahead/recommendation'
import type { ResolvedEvent } from '@ahead/resolver'

export function partitionTimelineEvents(
  events: ResolvedEvent[],
  now: Date | string = new Date(),
) {
  const history: ResolvedEvent[] = []
  const current: ResolvedEvent[] = []
  for (const event of events)
    (eventEndedAt(event, now) ? history : current).push(event)
  return { history, current }
}
