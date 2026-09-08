import type { AuthSession } from '@ahead/core'
import { githubSyncAdapter } from './github-sync'
export interface SyncAdapter {
  readonly id: string
  connect(session: AuthSession, address: string, path: string): Promise<string>
  discover(session: AuthSession, progress: (message: string) => void, signal: AbortSignal): Promise<void>
  classify(error: unknown): { retryable: boolean; authentication: boolean; message: string; retryAfter: number }
  synchronize(spaceId: string, session: AuthSession, validate: () => void): Promise<void>
}
const adapters = new Map<string, SyncAdapter>([[githubSyncAdapter.id, githubSyncAdapter]])
export function syncAdapter(id: string): SyncAdapter {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error('Unsupported sync provider: ' + id)
  return adapter
}

export const defaultSyncProvider = githubSyncAdapter.id
