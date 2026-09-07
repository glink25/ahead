import { eventEndedAt } from '@ahead/recommendation'
import type { ResolvedEvent } from '@ahead/resolver'

export function partitionTimelineEvents<T extends ResolvedEvent>(
  events: T[],
  now: Date | string = new Date(),
) {
  const history: T[] = []
  const current: T[] = []
  for (const event of events)
    (eventEndedAt(event, now) ? history : current).push(event)
  return { history, current }
}
