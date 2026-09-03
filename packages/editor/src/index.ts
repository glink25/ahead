import { parseYaml, stringifyYaml } from '@ahead/protocol'
import {
  createValidator,
  type Event,
  type EventFeed,
  type SchemaName,
  type UserData,
  type ValidationResult,
} from '@ahead/schema'

export interface EditorValidation extends ValidationResult {
  message?: string
}

const validator = createValidator()

class DocumentEditorState<T extends object> {
  protected value: T
  yaml: string

  constructor(
    value: T,
    private readonly schemaName: SchemaName,
  ) {
    this.value = structuredClone(value)
    this.yaml = stringifyYaml(this.value)
  }

  toDocument(): T {
    return structuredClone(this.value)
  }

  setField<K extends keyof T>(field: K, value: T[K]): this {
    this.value[field] = value
    this.yaml = stringifyYaml(this.value)
    return this
  }

  setYaml(source: string): this {
    this.yaml = source
    try {
      this.value = parseYaml<T>(source)
    } catch {
      // Keep the last valid form value; validate() reports the YAML error.
    }
    return this
  }

  validate(): EditorValidation {
    let parsed: unknown
    try {
      parsed = parseYaml(this.yaml)
    } catch (error) {
      return {
        ok: false,
        errors: null,
        message: error instanceof Error ? error.message : 'YAML 解析失败',
      }
    }
    const result = validator.validate(this.schemaName, parsed)
    if (result.ok) this.value = parsed as T
    return result
  }
}

export class EventEditorState extends DocumentEditorState<Event> {
  static fromEvent(event: Event): EventEditorState {
    return new EventEditorState(event)
  }

  constructor(event: Event) {
    super(event, 'event')
  }

  toEvent(): Event {
    return this.toDocument()
  }

  setDuration(duration: Event['duration']): this {
    if (!duration) {
      const { duration: _removed, ...rest } = this.value
      this.value = rest as Event
    } else {
      this.value.duration = duration
    }
    this.yaml = stringifyYaml(this.value)
    return this
  }
}

export class FeedEditorState extends DocumentEditorState<EventFeed> {
  static fromFeed(feed: EventFeed): FeedEditorState {
    return new FeedEditorState(feed)
  }

  constructor(feed: EventFeed) {
    super(feed, 'event-feed')
  }

  toFeed(): EventFeed {
    return this.toDocument()
  }
}

export class ProfileEditorState extends DocumentEditorState<UserData> {
  static fromProfile(profile: UserData): ProfileEditorState {
    return new ProfileEditorState(profile)
  }

  constructor(profile: UserData) {
    super(profile, 'user-data')
  }

  toProfile(): UserData {
    return this.toDocument()
  }
}
