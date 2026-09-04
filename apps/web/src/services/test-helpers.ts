import type { KeyValueStore } from '../lib/idb'
export function memory(): KeyValueStore {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => {
      map.set(key, value)
    },
    delete: async (key) => {
      map.delete(key)
    },
    keys: async () => [...map.keys()],
    update: async <T>(key: string, change: (value: T | undefined) => T) => {
      const value = change(map.get(key) as T | undefined)
      map.set(key, value)
      return value
    },
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
