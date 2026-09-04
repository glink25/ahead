import {
  mergeRecords,
  applyChanges,
  entries,
  equal,
  type Space,
  type Target,
} from '@ahead/sync'
import type { AuthSession, RepositoryAdapter } from '@ahead/core'
import { authenticatedAdapter } from '../lib/auth'
import { database, useData, changed } from './local'
import { eventFeed, materializeProfile, PERSONAL_FEED } from './model'
import { sourceKey, manifestPath } from '@ahead/protocol'
import {
  checkedTarget,
  httpStatus,
  locatorFor,
  syncDocument,
  readDocument,
} from './remote'
let session: AuthSession | null = null
let epoch = 0
let debounce: ReturnType<typeof setTimeout> | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
let periodic: ReturnType<typeof setInterval> | undefined
let running = false
let syncRequested = false
let lastPending = ''
export function setSyncSession(next: AuthSession | null) {
  session = next
  epoch++
  requestSync(true)
}
const accountId = (s: AuthSession) => String(s.identity.id)
async function updateSpace(id: string, update: (space: Space) => void) {
  await database.transaction((db) => {
    const space = db.spaces[id]
    if (space) update(space)
  })
  changed()
}
async function ensureRepository(
  adapter: RepositoryAdapter,
  space: Space,
  kind: 'remote' | 'feed',
  owner: string,
  collision = 0,
): Promise<Target> {
  if (space[kind]) return space[kind]!
  const field = kind === 'remote' ? 'provision' : 'feedProvision'
  let provision = space[field]
  if (!provision) {
    provision = {
      repo: 'ahead-feed-personal-' + space.id.slice(0, 8),
      marker: space.id + '-feed',
    }
    await updateSpace(space.id, (s) => {
      s[field] = provision
    })
  }
  const target: Target = {
    owner,
    repo: provision.repo,
    path: 'ahead.yaml',
    private: space.private,
  }
  const marker = 'Ahead managed ' + provision.marker
  try {
    const existing = await adapter.inspect(locatorFor(target))
    if (existing.description !== marker) {
      if (collision >= 3)
        throw new Error('同名仓库已存在，请更改待创建的仓库名称')
      const next = {
        ...provision,
        repo: provision.repo + '-' + crypto.randomUUID().slice(0, 4),
      }
      await updateSpace(space.id, (s) => {
        s[field] = next
      })
      return ensureRepository(
        adapter,
        { ...space, [field]: next },
        kind,
        owner,
        collision + 1,
      )
    }
    checkedTarget(existing, target)
    target.repositoryId = existing.repositoryId
  } catch (error) {
    if (httpStatus(error) !== 404) throw error
    // Persisted deterministic name + marker make lost create responses recoverable.
    await adapter.createRepository({
      name: target.repo,
      description: marker,
      private: target.private,
      autoInit: true,
    })
    const created = await adapter.inspect(locatorFor(target))
    checkedTarget(created, target)
    target.repositoryId = created.repositoryId
  }
  await updateSpace(space.id, (s) => {
    s[kind] = target
  })
  return target
}
async function synchronize(id: string, auth: AuthSession, generation: number) {
  const adapter = authenticatedAdapter(auth)
  const current = (await database.query()).spaces[id]
  if (!current || current.account !== accountId(auth) || current.paused) return
  const valid = () => {
    if (generation !== epoch) throw new Error('SYNC_SESSION_CHANGED')
  }
  const guarded: RepositoryAdapter = {
    inspect: async (...args) => {
      valid()
      return adapter.inspect(...args)
    },
    readFile: async (...args) => {
      valid()
      return adapter.readFile(...args)
    },
    readTree: async (...args) => {
      valid()
      return adapter.readTree(...args)
    },
    commitFiles: async (...args) => {
      valid()
      return adapter.commitFiles(...args)
    },
    createRepository: async (...args) => {
      valid()
      return adapter.createRepository(...args)
    },
  }
  await updateSpace(id, (s) => {
    s.status = 'syncing'
    s.error = undefined
  })
  try {
    const target = await ensureRepository(
      guarded,
      current,
      'remote',
      auth.identity.login,
    )
    let space = (await database.query()).spaces[id]!
    // Read/merge Profile first to discover its existing Personal Feed, but commit
    // the feed before writing the profile association on newly created profiles.
    const profileRemote = await readDocument(
      guarded,
      target,
      'user-data',
      Boolean(space.provision),
    )
    await database.transaction((db) => {
      const s = db.spaces[id]!
      s.records = mergeRecords(s.records, profileRemote.records)
    })
    space = (await database.query()).spaces[id]!
    const link = materializeProfile(space.records).extensions?.[
      PERSONAL_FEED
    ] as { locator?: string; manifestPath?: string } | undefined
    if (
      space.feed &&
      link?.locator &&
      (link.locator !== 'github:' + space.feed.owner + '/' + space.feed.repo ||
        manifestPath(link.manifestPath) !== space.feed.path)
    ) {
      throw new Error('个人事件的同步位置已改变，请核对资料中的关联后重试')
    }
    if (link?.locator && !space.feed) {
      const match = /^github:([^/]+)\/([^/]+)$/.exec(link.locator)
      if (!match) throw new Error('个人事件流关联格式不正确')
      await updateSpace(id, (s) => {
        s.feed = {
          owner: match[1]!,
          repo: match[2]!,
          path: manifestPath(link.manifestPath),
          private: s.private,
        }
      })
      space = (await database.query()).spaces[id]!
    }
    if (
      space.feed ||
      Object.values(space.records).some((r) => r.collection === 'events')
    ) {
      const feed = await ensureRepository(
        guarded,
        space,
        'feed',
        auth.identity.login,
      )
      space = (await database.query()).spaces[id]!
      const snapshot = structuredClone(space)
      const records = await syncDocument(
        guarded,
        feed,
        'event-feed',
        snapshot,
        Boolean(space.feedProvision),
      )
      valid()
      await database.transaction((db) => {
        const s = db.spaces[id]!
        s.records = mergeRecords(s.records, records)
        const confirmed = new Set(
          Object.values(snapshot.records)
            .filter((r) => ['events', 'feed'].includes(r.collection))
            .flatMap((r) => [
              r.operation,
              ...r.history.map((h) => h.operation),
            ]),
        )
        s.pending = s.pending.filter((op) => !confirmed.has(op))
        delete s.feedProvision
        const source = {
          locator: 'github:' + feed.owner + '/' + feed.repo,
          manifestPath: feed.path,
          kind: 'event-feed' as const,
        }
        applyChanges(db, s, [
          { collection: 'extensions', key: PERSONAL_FEED, value: source },
          {
            collection: 'subscriptions',
            key: sourceKey(source),
            value: source,
          },
        ])
      })
    }
    space = (await database.query()).spaces[id]!
    const records = await syncDocument(
      guarded,
      target,
      'user-data',
      space,
      Boolean(space.provision),
    )
    valid()
    await database.transaction((db) => {
      const s = db.spaces[id]!
      s.records = mergeRecords(s.records, records)
      const confirmed = new Set(
        Object.values(space.records)
          .filter((r) => !['events', 'feed'].includes(r.collection))
          .flatMap((r) => [r.operation, ...r.history.map((h) => h.operation)]),
      )
      s.pending = s.pending.filter((op) => !confirmed.has(op))
      delete s.provision
      s.name =
        Object.values(materializeProfile(s.records).displayName)[0] ?? s.name
      s.status = s.pending.length ? 'pending' : 'synced'
      s.lastSynced = new Date().toISOString()
      s.attempts = 0
      s.retryAt = undefined
    })
    changed()
  } catch (error) {
    if (generation !== epoch) return
    const status = httpStatus(error)
    await updateSpace(id, (s) => {
      s.attempts = (s.attempts ?? 0) + 1
      const message = String(error)
      const headers = (
        error as { response?: { headers?: Record<string, string> } }
      ).response?.headers
      const throttled =
        status === 403 &&
        (headers?.['x-ratelimit-remaining'] === '0' ||
          Boolean(headers?.['retry-after']))
      const transient =
        throttled ||
        !navigator.onLine ||
        error instanceof TypeError ||
        status === 429 ||
        (status !== undefined && status >= 500) ||
        message.includes('head changed') ||
        status === 409 ||
        status === 422
      s.status = !navigator.onLine
        ? 'offline'
        : status === 401
          ? 'auth'
          : transient
            ? 'pending'
            : 'attention'
      s.error =
        status === 401
          ? '需要重新登录'
          : status === 403
            ? '请检查仓库授权或稍后重试'
            : message
      const retrySeconds =
        Number(headers?.['retry-after']) ||
        Math.max(
          0,
          Number(headers?.['x-ratelimit-reset']) * 1000 - Date.now(),
        ) / 1000
      s.retryAt =
        Date.now() +
        Math.max(
          retrySeconds * 1000,
          Math.min(300000, 2000 * 2 ** Math.min(s.attempts, 7)) *
            (1 + Math.random() * 0.2),
        )
      if (transient)
        setTimeout(() => requestSync(), Math.max(1000, s.retryAt - Date.now()))
    })
  }
}
export function requestSync(immediate = false) {
  if (debounce) clearTimeout(debounce)
  if (immediate) {
    if (deadline) clearTimeout(deadline)
    deadline = undefined
    void run().catch(() => {})
    return
  }
  debounce = setTimeout(() => {
    if (deadline) clearTimeout(deadline)
    deadline = undefined
    void run().catch(() => {})
  }, 2000)
  deadline ??= setTimeout(() => {
    if (debounce) clearTimeout(debounce)
    deadline = undefined
    void run().catch(() => {})
  }, 15000)
}
async function run() {
  if (running) {
    syncRequested = true
    return
  }
  if (!session || !useData.getState().ready) return
  if (!navigator.onLine) {
    await database.transaction((db) => {
      for (const s of Object.values(db.spaces))
        if (s.account === accountId(session!) && !s.paused) s.status = 'offline'
    })
    return
  }
  running = true
  const auth = session,
    generation = epoch
  try {
    const work = async () => {
      const db = await database.query()
      for (const s of Object.values(db.spaces)) {
        if (generation !== epoch) break
        if (
          s.account !== accountId(auth) ||
          s.paused ||
          ['attention', 'auth'].includes(s.status) ||
          (s.retryAt ?? 0) > Date.now()
        )
          continue
        if (
          s.id === db.active ||
          s.pending.length ||
          s.provision ||
          s.feedProvision
        )
          await synchronize(s.id, auth, generation)
      }
    }
    if (navigator.locks)
      await navigator.locks.request(
        'ahead-sync-' + accountId(auth),
        { ifAvailable: true },
        async (lock) => {
          if (lock) await work()
        },
      )
    else await work()
  } finally {
    running = false
    if (syncRequested) {
      syncRequested = false
      requestSync()
    }
  }
}
export async function setPaused(id: string, paused: boolean) {
  await updateSpace(id, (s) => {
    s.paused = paused
    s.status = paused ? 'paused' : 'pending'
    s.retryAt = undefined
  })
  if (!paused) requestSync(true)
}
export async function syncNow(id: string) {
  await updateSpace(id, (s) => {
    s.status = 'pending'
    s.retryAt = undefined
    s.error = undefined
  })
  requestSync(true)
}
export function startScheduler() {
  if (periodic) return
  database.subscribe((db) => {
    const fingerprint = Object.values(db.spaces)
      .map((s) => s.id + ':' + s.pending.join(','))
      .join('|')
    if (fingerprint !== lastPending) {
      lastPending = fingerprint
      requestSync()
    }
  })
  window.addEventListener('online', () => requestSync(true))
  window.addEventListener('offline', () => requestSync(true))
  window.addEventListener('focus', () => requestSync(true))
  periodic = setInterval(() => {
    if (document.visibilityState === 'visible') requestSync(true)
  }, 60000)
}
