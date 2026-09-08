type Change = { identity: string; source: string }
const listeners = new Set<(change: Change) => void>()
const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('ahead-resources-v2')
channel?.addEventListener('message', (event: MessageEvent<Change>) => listeners.forEach((listener) => listener(event.data)))
export function resourceChanged(identity: string, source: string) {
  const change = { identity, source }
  listeners.forEach((listener) => listener(change))
  channel?.postMessage(change)
}
export function onResourceChange(listener: (change: Change) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
