/** The only IndexedDB database used by the application. */
const DATABASE_NAME = 'ahead'
const DATABASE_VERSION = 3
const STORE_NAMES = ['workspace-v3', 'auth', 'resources-v2', 'views-v2'] as const
type StoreName = (typeof STORE_NAMES)[number]

export interface LocalStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  update<T>(key: string, change: (value: T | undefined) => T): Promise<T>
  keys(): Promise<string[]>
}

export interface ViewSnapshot<T> {
  value: T
  storedAt: string
  lastAccessedAt: string
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

let connection: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      for (const name of STORE_NAMES)
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name)
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
  return connection
}

function rawStore(name: StoreName): LocalStore {
  async function transact<T>(
    mode: IDBTransactionMode,
    operation: (target: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await openDatabase()
    const transaction = database.transaction(name, mode)
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
      transaction.onerror = () => reject(transaction.error)
    })
    const [value] = await Promise.all([
      result(operation(transaction.objectStore(name))),
      completed,
    ])
    return value
  }

  return {
    get: <T>(key: string) =>
      transact<T | undefined>('readonly', (target) => target.get(key)),
    async set(key, value) {
      await transact('readwrite', (target) => target.put(value, key))
    },
    async delete(key) {
      await transact('readwrite', (target) => target.delete(key))
    },
    async update<T>(key: string, change: (value: T | undefined) => T) {
      const database = await openDatabase()
      return new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(name, 'readwrite')
        const target = transaction.objectStore(name)
        const read = target.get(key)
        let value: T
        let cause: unknown
        read.onsuccess = () => {
          try {
            value = change(read.result)
            if (value === undefined) target.delete(key)
            else target.put(value, key)
          } catch (error) {
            cause = error
            transaction.abort()
          }
        }
        transaction.oncomplete = () => resolve(value)
        transaction.onabort = () => reject(cause ?? transaction.error ?? new Error('IndexedDB transaction aborted'))
        transaction.onerror = () => reject(transaction.error)
      })
    },
    async keys() {
      return (await transact<IDBValidKey[]>('readonly', (target) => target.getAllKeys())).map(String)
    },
  }
}

const evictions = new Map<string, () => Promise<void>>()
export function registerCacheEviction(identity: string, evict: () => Promise<void>) { evictions.set(identity, evict) }
async function withQuotaRecovery<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error
    await Promise.all([...evictions.values()].map((evict) => evict()))
    const disposable = rawStore('views-v2')
    await Promise.all((await disposable.keys()).map((key) => disposable.delete(key)))
    return operation()
  }
}
function store(name: StoreName): LocalStore {
  const base = rawStore(name)
  return {
    ...base,
    set: (key, value) => withQuotaRecovery(() => base.set(key, value)),
    update: (key, change) => withQuotaRecovery(() => base.update(key, change)),
  }
}

function scoped(base: LocalStore, prefix: string): LocalStore {
  const keyFor = (key: string) => `${prefix}\0${key}`
  return {
    get: <T>(key: string) => base.get<T>(keyFor(key)),
    set: (key, value) => base.set(keyFor(key), value),
    delete: (key) => base.delete(keyFor(key)),
    update: <T>(key: string, change: (value: T | undefined) => T) =>
      base.update(keyFor(key), change),
    async keys() {
      const start = prefix + '\0'
      return (await base.keys())
        .filter((key) => key.startsWith(start))
        .map((key) => key.slice(start.length))
    },
  }
}

export const workspaceStore = store('workspace-v3')
export const authStore = store('auth')
const resources = store('resources-v2')
const views = store('views-v2')

export const resourceStore = (identity: string, namespace = 'content') =>
  scoped(resources, `${identity}\0${namespace}`)

export function viewStore(
  identity: string,
  namespace: string,
  limit = 100,
): LocalStore {
  const target = scoped(views, `${identity}\0${namespace}`)
  const prune = async () => {
    const keys = await target.keys()
    if (keys.length <= limit) return
    const entries = await Promise.all(keys.map(async (key) => ({
      key,
      snapshot: await target.get<ViewSnapshot<unknown>>(key),
    })))
    entries.sort((left, right) =>
      (left.snapshot?.lastAccessedAt ?? '').localeCompare(right.snapshot?.lastAccessedAt ?? ''),
    )
    await Promise.all(entries.slice(0, keys.length - limit).map(({ key }) => target.delete(key)))
  }
  return {
    async get<T>(key: string) {
      const snapshot = await target.get<ViewSnapshot<T>>(key)
      if (!snapshot) return undefined
      void target.update<ViewSnapshot<T> | undefined>(key, (current) => current ? { ...current, lastAccessedAt: new Date().toISOString() } : undefined).catch(() => {})
      return snapshot.value
    },
    async set(key, value) {
      const now = new Date().toISOString()
      await target.set(key, { value, storedAt: now, lastAccessedAt: now } satisfies ViewSnapshot<unknown>)
      void prune().catch(() => {})
    },
    delete: (key) => target.delete(key),
    async update<T>(key: string, change: (value: T | undefined) => T) {
      const now = new Date().toISOString()
      const snapshot = await target.update<ViewSnapshot<T>>(key, (previous) => ({
        value: change(previous?.value),
        storedAt: previous?.storedAt ?? now,
        lastAccessedAt: now,
      }))
      void prune().catch(() => {})
      return snapshot.value
    },
    keys: () => target.keys(),
  }
}

export function identityScope(session: {
  providerId: string
  identity: { id: string | number }
} | null | undefined): string {
  return session ? `${session.providerId}:${session.identity.id}` : 'guest'
}
