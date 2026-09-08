import { LocalDatabase, type Database } from '@ahead/sync'
import { workspaceStore } from '../data/storage'
import { materializeProfile, personalEvents, profileCollections, validEvent } from '../data/model'

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
}
