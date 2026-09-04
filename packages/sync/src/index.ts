/** Transport-independent local-first records. One revision per business record. */
export interface Revision {
  time: number
  counter: number
  device: string
}
export interface Version {
  value?: unknown
  deleted: boolean
  revision: Revision
  operation: string
}
export interface RecordValue extends Version {
  collection: string
  key: string
  history: Version[]
}
export type Records = Record<string, RecordValue>
export interface Change {
  collection: string
  key: string
  value?: unknown
  deleted?: boolean
}
export interface Target {
  owner: string
  repo: string
  path: string
  private: boolean
  repositoryId?: number
}
export type SyncStatus =
  | 'local'
  | 'pending'
  | 'offline'
  | 'syncing'
  | 'synced'
  | 'auth'
  | 'attention'
  | 'paused'
export interface Space {
  id: string
  account?: string
  records: Records
  pending: string[]
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
  provision?: { repo: string; marker: string }
  feedProvision?: { repo: string; marker: string }
  guestImported?: boolean
}
export interface Database {
  version: 1
  device: string
  clock: Revision
  spaces: Record<string, Space>
  active: string
  selected: Record<string, string>
  migrated?: boolean
  migrationBackup?: unknown
  guestBackups?: Records[]
}
export interface AtomicStorage {
  read(): Promise<Database | undefined>
  update(change: (value: Database | undefined) => Database): Promise<Database>
}
export const recordKey = (collection: string, key: string) =>
  JSON.stringify([collection, key])
export function compare(a: Revision, b: Revision): number {
  return (
    a.time - b.time || a.counter - b.counter || a.device.localeCompare(b.device)
  )
}
export function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ':' +
            canonical((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'undefined'
}
export function mergeRecords(left: Records, right: Records): Records {
  const result: Records = structuredClone(left)
  for (const [id, incoming] of Object.entries(right)) {
    const previous = result[id]
    if (!previous) {
      result[id] = structuredClone(incoming)
      continue
    }
    const versions = new Map<string, Version>()
    for (const value of [
      ...previous.history,
      previous,
      ...incoming.history,
      incoming,
    ]) {
      versions.set(value.operation, {
        value: value.value,
        deleted: value.deleted,
        revision: value.revision,
        operation: value.operation,
      })
    }
    const sorted = [...versions.values()].sort(
      (a, b) =>
        compare(b.revision, a.revision) ||
        b.operation.localeCompare(a.operation),
    )
    result[id] = {
      collection: incoming.collection,
      key: incoming.key,
      ...sorted[0]!,
      history: sorted.slice(1, 21),
    }
  }
  return result
}
export function entries(
  records: Records,
  collection: string,
): [string, unknown][] {
  return Object.values(records)
    .filter((r) => r.collection === collection && !r.deleted)
    .map((r) => [r.key, r.value])
}
export function applyChanges(
  db: Database,
  space: Space,
  changes: Change[],
  now = Date.now(),
): void {
  for (const change of changes) {
    const id = recordKey(change.collection, change.key),
      old = space.records[id]
    if (
      old &&
      old.deleted === Boolean(change.deleted) &&
      equal(old.value, change.value)
    )
      continue
    let observed = db.clock
    for (const record of Object.values(space.records))
      if (compare(record.revision, observed) > 0) observed = record.revision
    const time = Math.max(now, observed.time)
    db.clock = {
      time,
      counter: time === observed.time ? observed.counter + 1 : 0,
      device: db.device,
    }
    const record: RecordValue = {
      collection: change.collection,
      key: change.key,
      value: change.value,
      deleted: Boolean(change.deleted),
      revision: { ...db.clock },
      operation: crypto.randomUUID(),
      history: [],
    }
    space.records = mergeRecords(space.records, { [id]: record })
    space.pending = space.pending.filter((op) => op !== old?.operation)
    space.pending.push(record.operation)
  }
  space.status = space.paused ? 'paused' : space.account ? 'pending' : 'local'
}
export function newSpace(id: string, name: string, privateRepo = true): Space {
  return {
    id,
    name,
    private: privateRepo,
    records: {},
    pending: [],
    status: 'local',
  }
}
export function newDatabase(): Database {
  const device = crypto.randomUUID()
  return {
    version: 1,
    device,
    clock: { time: 0, counter: 0, device },
    spaces: { guest: newSpace('guest', '本机资料') },
    active: 'guest',
    selected: {},
  }
}
export class LocalDatabase {
  private listeners = new Set<(db: Database) => void>()
  private aggregate?: (records: Records) => void
  validateWith(fn: (records: Records) => void) {
    this.aggregate = fn
    return this
  }
  private validators = new Map<string, (value: unknown) => boolean>()
  constructor(readonly storage: AtomicStorage) {}
  register(collection: string, validate: (value: unknown) => boolean) {
    this.validators.set(collection, validate)
    return this
  }
  subscribe(listener: (db: Database) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  async query() {
    return (await this.storage.read()) ?? newDatabase()
  }
  async reload() {
    const db = await this.query()
    this.listeners.forEach((fn) => fn(db))
    return db
  }
  async transaction(change: (db: Database) => void): Promise<Database> {
    const db = await this.storage.update((stored) => {
      if (stored && stored.version !== 1)
        throw new Error('Unsupported local data version')
      const value = stored ?? newDatabase()
      change(value)
      for (const space of Object.values(value.spaces))
        this.aggregate?.(space.records)
      return value
    })
    this.listeners.forEach((fn) => fn(db))
    return db
  }
  async mutate(
    spaceId: string,
    makeChanges: Change[] | ((records: Records) => Change[]),
  ) {
    return this.transaction((db) => {
      const space = db.spaces[spaceId]
      if (!space) throw new Error('Profile not found')
      const changes =
        typeof makeChanges === 'function'
          ? makeChanges(space.records)
          : makeChanges
      for (const change of changes) {
        const validate = this.validators.get(change.collection)
        if (!validate || (!change.deleted && !validate(change.value)))
          throw new Error('Invalid ' + change.collection + ' value')
      }
      applyChanges(db, space, changes)
    })
  }
}
export interface RemoteEnvelope {
  version: 1
  records: Records
  projection: unknown
}
export function parseEnvelope(value: unknown): RemoteEnvelope {
  const object = value as RemoteEnvelope
  if (
    !object ||
    object.version !== 1 ||
    !object.records ||
    typeof object.records !== 'object' ||
    Array.isArray(object.records)
  )
    throw new Error('Unsupported sync format')
  for (const [id, r] of Object.entries(object.records)) {
    if (
      !r ||
      typeof r.collection !== 'string' ||
      typeof r.key !== 'string' ||
      id !== recordKey(r.collection, r.key) ||
      !Array.isArray(r.history)
    )
      throw new Error('Invalid sync record')
    for (const v of [r, ...r.history])
      if (
        !v.revision ||
        !Number.isSafeInteger(v.revision.time) ||
        !Number.isSafeInteger(v.revision.counter) ||
        typeof v.revision.device !== 'string' ||
        typeof v.operation !== 'string' ||
        typeof v.deleted !== 'boolean'
      )
        throw new Error('Invalid sync revision')
  }
  return object
}
