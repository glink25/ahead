import { createValidator, type UserData, type Subscription } from '@ahead/schema'
import { sourceKey } from '@ahead/protocol'

export const emptyProfile = (): UserData => ({
  oefVersion: '0.1', kind: 'user-data', id: 'local', displayName: { 'zh-CN': '我的盼头', en: 'My Ahead' },
  subscriptions: [], favorites: [], hidden: [], pins: [], interests: {},
})

export type ProfileAction =
  | { type: 'subscribe' | 'unsubscribe'; source: Subscription }
  | { type: 'favorite' | 'unfavorite' | 'hide' | 'unhide'; id: string; tags?: string[] }
  | { type: 'priority'; source: Subscription; priority: number }
  | { type: 'interest'; tags: string[]; amount: number }
  | { type: 'privacy'; enabled: boolean }
  | { type: 'week-start'; value?: 'sunday' | 'monday' }

export function changeProfile(profile: UserData, action: ProfileAction): UserData {
  const next = structuredClone(profile)
  const bump = (tags: string[], delta: number) => {
    next.interests ??= {}
    for (const tag of new Set(tags)) next.interests[tag] = Math.max(-1, Math.min(1, (next.interests[tag] ?? 0) + delta))
  }
  if (action.type === 'subscribe' || action.type === 'unsubscribe' || action.type === 'priority') {
    const key = sourceKey(action.source)
    const existing = next.subscriptions?.find((source) => sourceKey(source) === key)
    next.subscriptions = (next.subscriptions ?? []).filter((source) => sourceKey(source) !== key)
    if (action.type !== 'unsubscribe') next.subscriptions.push({
      ...existing, ...action.source,
      ...(action.type === 'priority' ? { priority: action.priority } : {}),
    })
  } else if (action.type === 'interest') bump(action.tags, action.amount)
  else if (action.type === 'privacy') next.settings = { ...next.settings, privacyRemoteImages: action.enabled }
  else if (action.type === 'week-start') {
    next.settings = { ...next.settings }
    if (action.value) next.settings.weekStartsOn = action.value
    else delete next.settings.weekStartsOn
  }
  else if ('id' in action) {
    const key = action.type === 'favorite' || action.type === 'unfavorite' ? 'favorites' : 'hidden'
    const items = new Set(next[key] ?? [])
    const adding = action.type === 'favorite' || action.type === 'hide'
    if (adding && !items.has(action.id)) bump(action.tags ?? [], action.type === 'favorite' ? .15 : -.1)
    if (adding) items.add(action.id)
    else items.delete(action.id)
    next[key] = [...items]
  }
  const result = createValidator().validate('user-data', next)
  if (!result.ok) throw new Error('messages.personal_data_exceeds_protocol_limits_changes_were_not_saved')
  return next
}
