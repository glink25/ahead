import type { AuthSession } from '@ahead/core'
import type { Space } from '@ahead/sync'
import { githubSyncAdapter } from './github-sync'

export interface ProfileActionTarget {
  kind: 'profile' | 'events'
  locator: string
  url: string
}

export type ProfileAction =
  | {
      type: 'share' | 'delete'
      mode: 'external'
      targets: ProfileActionTarget[]
    }
  | {
      type: 'delete'
      mode: 'execute'
      disabledReason?: 'active-profile'
      execute(): Promise<void>
    }

export interface ProfileOperationsAdapter {
  profileActions(space: Space, activeSpaceId: string): readonly ProfileAction[]
}

export interface SyncAdapter extends ProfileOperationsAdapter {
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
