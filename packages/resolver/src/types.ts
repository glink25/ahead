import type {
  Duration,
  Event,
  EventFeed,
  ScheduleTimelineEntry,
  UserData,
} from '@ahead/schema'

export interface FieldProvenance {
  field: string
  sourceLocator: string
  reason: 'initial' | 'filled' | 'merged' | 'overridden' | 'deduplicated'
}

export interface ProvenancedEvent {
  event: Event
  sourceLocator: string
  priority?: number
}

export interface ResolvedEvent extends Event {
  currentSchedule?: ScheduleTimelineEntry
  sourceLocators: string[]
  provenance: FieldProvenance[]
}

export interface Occurrence {
  id: string
  eventId: string
  index: number
  start: string
  /** Exclusive ISO end; omitted when no duration or imprecise anchor. */
  end?: string
  duration?: Duration
  event: Event
}

export type FeedResource =
  | EventFeed
  | { feed: EventFeed; sourceLocator: string; priority?: number }
  | { resource: EventFeed; sourceLocator: string; priority?: number }

export type UserResource =
  | UserData
  | { user: UserData; sourceLocator: string }
  | { resource: UserData; sourceLocator: string }

export interface ResolvedProfile {
  id: string
  profile: UserData
  events: ResolvedEvent[]
  locale: string
  timezone: string
  now: string
  favorites: string[]
  remoteFavorites: Record<string, number>
  hidden: string[]
  pins: string[]
  interests: Record<string, number>
  subscriptionPriorities: Record<string, number>
}
