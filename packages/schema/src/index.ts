import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { ErrorObject, ValidateFunction } from 'ajv'
import durationSchema from '../schemas/duration.json'
import evidenceSchema from '../schemas/evidence.json'
import eventFeedSchema from '../schemas/event-feed.json'
import eventSchema from '../schemas/event.json'
import localizedTextSchema from '../schemas/localized-text.json'
import locatorSchema from '../schemas/locator.json'
import patchSchema from '../schemas/patch.json'
import recurrenceSchema from '../schemas/recurrence.json'
import scheduleTimelineSchema from '../schemas/schedule-timeline.json'
import tagSchema from '../schemas/tag.json'
import temporalValueSchema from '../schemas/temporal-value.json'
import userDataSchema from '../schemas/user-data.json'

export const SCHEMAS_DIR = new URL('../schemas/', import.meta.url).pathname

export type SchemaName =
  | 'localized-text'
  | 'tag'
  | 'evidence'
  | 'temporal-value'
  | 'schedule-timeline'
  | 'recurrence'
  | 'duration'
  | 'event'
  | 'event-feed'
  | 'patch'
  | 'user-data'
  | 'locator'

const SCHEMA_FILES: Record<SchemaName, string> = {
  'localized-text': 'localized-text.json',
  tag: 'tag.json',
  evidence: 'evidence.json',
  'temporal-value': 'temporal-value.json',
  'schedule-timeline': 'schedule-timeline.json',
  recurrence: 'recurrence.json',
  duration: 'duration.json',
  event: 'event.json',
  'event-feed': 'event-feed.json',
  patch: 'patch.json',
  'user-data': 'user-data.json',
  locator: 'locator.json',
}

export interface ValidationResult {
  ok: boolean
  errors: ErrorObject[] | null | undefined
}

const SCHEMAS = [
  durationSchema,
  evidenceSchema,
  eventFeedSchema,
  eventSchema,
  localizedTextSchema,
  locatorSchema,
  patchSchema,
  recurrenceSchema,
  scheduleTimelineSchema,
  tagSchema,
  temporalValueSchema,
  userDataSchema,
] as const

export function createValidator() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: false,
  })
  addFormats(ajv)

  for (const schema of SCHEMAS) {
    ajv.addSchema(schema)
  }

  const cache = new Map<SchemaName, ValidateFunction>()

  function get(name: SchemaName): ValidateFunction {
    let fn = cache.get(name)
    if (!fn) {
      const id = `https://github.com/glink25/ahead/raw/main/schemas/v0.1/${SCHEMA_FILES[name]}`
      const compiled = ajv.getSchema(id)
      if (!compiled) {
        throw new Error(`Schema not found: ${name} (${id})`)
      }
      fn = compiled
      cache.set(name, fn)
    }
    return fn
  }

  function validate(name: SchemaName, data: unknown): ValidationResult {
    const fn = get(name)
    const ok = fn(data) as boolean
    return { ok, errors: fn.errors }
  }

  return { ajv, validate, get, schemaNames: Object.keys(SCHEMA_FILES) as SchemaName[] }
}

export type OefValidator = ReturnType<typeof createValidator>

export * from './types.js'

export function schemaPath(name: SchemaName): string {
  return new URL(`../schemas/${SCHEMA_FILES[name]}`, import.meta.url).pathname
}
