import type { AuthSession } from '@ahead/core'
import { parseLocator } from '@ahead/protocol'
import { defaultSyncProvider, syncAdapter } from '../adapters/sync'
export function connectProfile(auth: AuthSession, address: string, path = 'ahead.yaml') { return syncAdapter(parseLocator(address).scheme).connect(auth, address, path) }
export function discoverProfiles(auth: AuthSession, progress: (message: string) => void, signal: AbortSignal) { return syncAdapter(defaultSyncProvider).discover(auth, progress, signal) }
