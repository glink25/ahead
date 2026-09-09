import { LocalDatabase, type Database, type Space } from '@ahead/sync'
import { workspaceStore } from '../data/storage'
import { materializeProfile, personalEvents, profileCollections, validEvent } from '../data/model'
import type { ProfileAction } from './sync'

/** Durable workspace storage. Has no authentication, transport, or network dependency. */
export class LocalWorkspaceAdapter extends LocalDatabase {
  private channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('ahead-workspace-v3')
  constructor() {
    super({
      read: () => workspaceStore.get<Database>('root'),
      update: (change) => workspaceStore.update('root', change),
    })
    this.channel?.addEventListener('message', () => { void this.reload().catch((error) => this.onReadError?.(error)) })
    for (const name of [...profileCollections, 'feed']) this.register(name, () => true)
    this.register('events', validEvent)
    this.validateWith((records) => { materializeProfile(records); personalEvents(records) })
  }
  onReadError?: (error: unknown) => void
  override async transaction(change: (db: Database) => void) {
    const db = await super.transaction(change)
    this.channel?.postMessage('changed')
    return db
  }
  profileActions(space: Space, activeSpaceId: string): ProfileAction[] {
    if (space.id === 'guest') return []
    return [{
      type: 'delete',
      mode: 'execute',
      ...(space.id === activeSpaceId ? { disabledReason: 'active-profile' as const } : {}),
      execute: () => this.deleteProfile(space.id),
    }]
  }
  private async deleteProfile(id: string) {
    await this.transaction((db) => {
      if (id === 'guest' || db.active === id) throw new Error('messages.cannot_delete_the_current_profile')
      if (!db.spaces[id]) throw new Error('messages.profile_not_found')
      delete db.spaces[id]
      for (const [account, selected] of Object.entries(db.selected))
        if (selected === id) delete db.selected[account]
    })
  }
}
