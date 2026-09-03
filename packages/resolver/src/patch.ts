import type { Event, Patch } from '@ahead/schema'

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

function segments(path: string): string[] {
  const parts = path.startsWith('/')
    ? path
        .slice(1)
        .split('/')
        .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    : path.split('.')
  const result = parts.filter(Boolean)
  if (result.some((part) => FORBIDDEN_SEGMENTS.has(part))) {
    throw new Error(`Unsafe patch path: ${path}`)
  }
  return result
}

function mergeObjects(left: unknown, right: unknown): unknown {
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const result = structuredClone(left) as Record<string, unknown>
    for (const [key, value] of Object.entries(right as Record<string, unknown>)) {
      if (FORBIDDEN_SEGMENTS.has(key)) throw new Error(`Unsafe merge key: ${key}`)
      result[key] = mergeObjects(result[key], value)
    }
    return result
  }
  return structuredClone(right)
}

export function applyPatches(event: Event, patches: readonly Patch[]): Event {
  const result = structuredClone(event) as unknown as Record<string, unknown>

  for (const patch of patches) {
    if (patch.eventId !== event.id) continue
    for (const operation of patch.ops) {
      const path = segments(operation.path)
      if (path.length === 0 || path[0] === 'id') {
        throw new Error(`Patch cannot modify the event identity: ${operation.path}`)
      }

      let parent = result
      for (const part of path.slice(0, -1)) {
        const current = parent[part]
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          parent[part] = {}
        }
        parent = parent[part] as Record<string, unknown>
      }
      const key = path.at(-1)!

      if (operation.op === 'unset') {
        delete parent[key]
      } else if (operation.op === 'set') {
        parent[key] = structuredClone(operation.value)
      } else {
        parent[key] = mergeObjects(parent[key], operation.value)
      }
    }
  }

  return result as unknown as Event
}
