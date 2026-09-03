import type { Event } from '@ahead/schema'
import { selectCurrentSchedule } from './schedule.js'
import type { FieldProvenance, ProvenancedEvent, ResolvedEvent } from './types.js'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function stableValue(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
    .join(',')}}`
}

function mergeArrays(left: unknown[], right: unknown[]): unknown[] {
  const result = left.map(clone)
  const seen = new Set(result.map(stableValue))
  for (const item of right) {
    const key = stableValue(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(clone(item))
    }
  }
  return result
}

function mergeValue(left: unknown, right: unknown): unknown {
  if (left === undefined) return clone(right)
  if (Array.isArray(left) && Array.isArray(right)) return mergeArrays(left, right)
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const result = clone(left) as Record<string, unknown>
    for (const [key, value] of Object.entries(right as Record<string, unknown>)) {
      result[key] = mergeValue(result[key], value)
    }
    return result
  }
  return left
}

export function mergeEvents(inputs: readonly ProvenancedEvent[]): ResolvedEvent[] {
  const ordered = [...inputs].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.sourceLocator.localeCompare(b.sourceLocator) ||
      a.event.id.localeCompare(b.event.id),
  )
  const byId = new Map<string, ResolvedEvent>()

  for (const { event, sourceLocator } of ordered) {
    const existing = byId.get(event.id)
    if (!existing) {
      const provenance: FieldProvenance[] = Object.keys(event)
        .sort()
        .map((field) => ({ field, sourceLocator, reason: 'initial' }))
      const created = clone(event) as ResolvedEvent
      created.sourceLocators = [sourceLocator]
      created.provenance = provenance
      created.currentSchedule = selectCurrentSchedule(created.schedule)
      byId.set(event.id, created)
      continue
    }

    if (!existing.sourceLocators.includes(sourceLocator)) {
      existing.sourceLocators.push(sourceLocator)
      existing.sourceLocators.sort()
    }
    for (const [field, value] of Object.entries(event) as [keyof Event, unknown][]) {
      if (field === 'id') {
        existing.provenance.push({ field, sourceLocator, reason: 'deduplicated' })
        continue
      }
      const before = existing[field]
      const merged = mergeValue(before, value)
      ;(existing as unknown as Record<string, unknown>)[field] = merged
      existing.provenance.push({
        field,
        sourceLocator,
        reason: before === undefined ? 'filled' : stableValue(before) === stableValue(merged) ? 'deduplicated' : 'merged',
      })
    }
    existing.currentSchedule = selectCurrentSchedule(existing.schedule)
  }

  return [...byId.values()]
    .map((event) => ({
      ...event,
      provenance: event.provenance.sort(
        (a, b) => a.field.localeCompare(b.field) || a.sourceLocator.localeCompare(b.sourceLocator),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
