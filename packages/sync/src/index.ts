/** Transport-independent remote baseline plus local pending patches. */
export interface RecordValue { collection: string; key: string; value: unknown }
export type Records = Record<string, RecordValue>
export interface Change { collection: string; key: string; value?: unknown; deleted?: boolean }
export interface Patch extends Change { operation: string }
export interface Target { locator: string; path: string; private: boolean; version?: string; metadata?: Record<string, unknown> }
export interface Provision { name: string }
export type SyncStatus = 'local' | 'pending' | 'offline' | 'syncing' | 'synced' | 'auth' | 'attention' | 'paused'
export interface Space {
  id: string
  account?: string
  syncProvider?: string
  baseRecords: Records
  patches: Record<string, Patch>
  remote?: Target
  feed?: Target
  private: boolean
  name: string
  status: SyncStatus
  paused?: boolean
  lastSynced?: string
  error?: string
  retryAt?: number
  attempts?: number
  provision?: Provision
  feedProvision?: Provision
  guestImported?: boolean
}
export interface Database {
  version: 2
  spaces: Record<string, Space>
  active: string
  selected: Record<string, string>
  guestBackups?: Records[]
}
export interface AtomicStorage {
  read(): Promise<Database | undefined>
  update(change: (value: Database | undefined) => Database): Promise<Database>
}

export const recordKey = (collection: string, key: string) => JSON.stringify([collection, key])

export function equal(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b) }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}'
  return JSON.stringify(value) ?? 'undefined'
}

export function applyPatches(baseRecords: Records, patches: Record<string, Patch>): Records {
  const result = structuredClone(baseRecords)
  for (const [id, patch] of Object.entries(patches)) {
    if (patch.deleted) delete result[id]
    else result[id] = { collection: patch.collection, key: patch.key, value: structuredClone(patch.value) }
  }
  return result
}

export function workspaceRecords(space: Space): Records { return applyPatches(space.baseRecords, space.patches) }

export function entries(records: Records, collection: string): [string, unknown][] {
  return Object.values(records).filter((record) => record.collection === collection).map((record) => [record.key, record.value])
}

export function recordsFromChanges(changes: Change[]): Records {
  const records: Records = {}
  for (const change of changes) if (!change.deleted) records[recordKey(change.collection, change.key)] = { collection: change.collection, key: change.key, value: structuredClone(change.value) }
  return records
}

export function replaceCollections(records: Records, incoming: Records, collections: ReadonlySet<string>): Records {
  return {
    ...Object.fromEntries(Object.entries(records).filter(([, record]) => !collections.has(record.collection))),
    ...structuredClone(incoming),
  }
}

export function applyChanges(_db: Database, space: Space, changes: Change[]): void {
  const current = workspaceRecords(space)
  for (const change of changes) {
    const id = recordKey(change.collection, change.key)
    const old = current[id]
    if (change.deleted ? !old : Boolean(old && equal(old.value, change.value))) continue
    const base = space.baseRecords[id]
    if (change.deleted) {
      if (base) space.patches[id] = { ...change, operation: crypto.randomUUID() }
      else delete space.patches[id]
      delete current[id]
    } else {
      if (base && equal(base.value, change.value)) delete space.patches[id]
      else space.patches[id] = { ...change, operation: crypto.randomUUID() }
      current[id] = { collection: change.collection, key: change.key, value: change.value }
    }
  }
  space.status = space.paused
    ? 'paused'
    : !space.syncProvider
      ? 'local'
      : Object.keys(space.patches).length || space.provision || space.feedProvision
        ? 'pending'
        : 'synced'
}

export function newSpace(id: string, name: string, privateRepo = true): Space {
  return { id, name, private: privateRepo, baseRecords: {}, patches: {}, status: 'local' }
}
export function newDatabase(): Database {
  return { version: 2, spaces: { guest: newSpace('guest', '本机资料') }, active: 'guest', selected: {} }
}

export class LocalDatabase {
  private listeners = new Set<(db: Database) => void>()
  private aggregate?: (records: Records) => void
  private validators = new Map<string, (value: unknown) => boolean>()
  constructor(readonly storage: AtomicStorage) {}
  validateWith(fn: (records: Records) => void) { this.aggregate = fn; return this }
  register(collection: string, validate: (value: unknown) => boolean) { this.validators.set(collection, validate); return this }
  subscribe(listener: (db: Database) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  async query() { return (await this.storage.read()) ?? newDatabase() }
  async reload() { const db = await this.query(); this.listeners.forEach((fn) => fn(db)); return db }
  async transaction(change: (db: Database) => void): Promise<Database> {
    const db = await this.storage.update((stored) => {
      if (stored && stored.version !== 2) throw new Error('Unsupported local data version')
      const value = stored ?? newDatabase()
      change(value)
      for (const space of Object.values(value.spaces)) this.aggregate?.(workspaceRecords(space))
      return value
    })
    this.listeners.forEach((fn) => fn(db))
    return db
  }
  async mutate(spaceId: string, makeChanges: Change[] | ((records: Records) => Change[])) {
    return this.transaction((db) => {
      const space = db.spaces[spaceId]
      if (!space) throw new Error('Profile not found')
      const records = workspaceRecords(space)
      const changes = typeof makeChanges === 'function' ? makeChanges(records) : makeChanges
      for (const change of changes) {
        const validate = this.validators.get(change.collection)
        if (!validate || (!change.deleted && !validate(change.value))) throw new Error('Invalid ' + change.collection + ' value')
      }
      applyChanges(db, space, changes)
    })
  }
}
