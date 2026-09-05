/** Hand-written OEF v0.1 types mirroring JSON Schema authority. */

export type LocalizedText = Record<string, string>

export interface Tag {
  id: string
  label?: LocalizedText
}

export type EvidenceKind = 'url' | 'note' | 'media' | 'citation'

export interface Evidence {
  kind: EvidenceKind
  value: string
  label?: LocalizedText
  fetchedAt?: string
}

export type TemporalValue =
  | { kind: 'exact'; date: string }
  | { kind: 'datetime'; dateTime: string; timezone?: string }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'quarter'; year: number; quarter: number }
  | { kind: 'year'; year: number }
  | { kind: 'range'; start: TemporalValue; end: TemporalValue }
  | { kind: 'unknown'; note?: LocalizedText }

export type ScheduleConfidence = 'confirmed' | 'likely' | 'rumored' | 'cancelled'

export interface ScheduleTimelineEntry {
  id: string
  value: TemporalValue
  recordedAt: string
  confidence?: ScheduleConfidence
  source?: string
  evidence?: Evidence[]
}

export type ScheduleTimeline = ScheduleTimelineEntry[]

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
  interval?: number
  byMonth?: number[]
  byMonthDay?: number[]
  count?: number
  until?: string
  timezone?: string
}

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks'

/** Wall-clock length after each occurrence start. Orthogonal to schedule/recurrence. */
export interface Duration {
  amount: number
  unit: DurationUnit
}

export interface EventMedia {
  path: string
  alt?: LocalizedText
  kind?: 'image' | 'video' | 'audio' | 'other'
}

export interface Event {
  id: string
  title: LocalizedText
  summary?: LocalizedText
  description?: LocalizedText
  schedule: ScheduleTimeline
  /** How long each occurrence lasts; omit for instantaneous / single-day point. */
  duration?: Duration
  recurrence?: Recurrence
  tags?: string[]
  evidence?: Evidence[]
  media?: EventMedia[]
  status?: 'active' | 'cancelled' | 'archived'
  extensions?: Record<string, unknown>
}

export interface EventFeed {
  oefVersion: '0.1'
  kind: 'event-feed'
  id: string
  name: LocalizedText
  description?: LocalizedText
  primaryLanguage?: string
  tags?: Tag[]
  events?: Event[]
  eventsGlob?: string
  extensions?: Record<string, unknown>
}

export interface PatchOp {
  op: 'set' | 'unset' | 'merge'
  path: string
  value?: unknown
}

export interface Patch {
  eventId: string
  ops: PatchOp[]
  note?: LocalizedText
  updatedAt?: string
}

export interface Subscription {
  locator: string
  manifestPath?: string
  priority?: number
  kind?: 'event-feed' | 'user-data'
}

export interface UserData {
  oefVersion: '0.1'
  kind: 'user-data'
  id: string
  displayName: LocalizedText
  bio?: LocalizedText
  subscriptions?: Subscription[]
  favorites?: string[]
  hidden?: string[]
  pins?: string[]
  notes?: Record<string, string>
  patches?: Patch[]
  interests?: Record<string, number>
  settings?: {
    locale?: string
    timezone?: string
    privacyRemoteImages?: boolean
    weekStartsOn?: 'sunday' | 'monday'
    [key: string]: unknown
  }
  extensions?: Record<string, unknown>
}

export type ResourceLocator = string
