import { describe, it, expect } from 'vitest'
import { emptyProfile, changeProfile } from './local-profile'
import { sourceKey } from '@ahead/protocol'
describe('local profile', () => {
  it('subscribes and removes separate manifests in one repository', () => {
    const gaming = { locator: 'github:a/b', manifestPath: 'feeds/gaming.yaml' }
    const tech = { ...gaming, manifestPath: 'feeds/tech.yaml' }
    let profile = changeProfile(emptyProfile(), { type: 'subscribe', source: gaming })
    profile = changeProfile(profile, { type: 'subscribe', source: tech })
    profile = changeProfile(profile, { type: 'subscribe', source: gaming })
    expect(profile.subscriptions).toHaveLength(2)
    profile = changeProfile(profile, { type: 'unsubscribe', source: gaming })
    expect(profile.subscriptions?.map(sourceKey)).toEqual([sourceKey(tech)])
    expect(sourceKey({ locator: 'github:A/B', manifestPath: 'ahead.yaml' })).toBe('github:a/b')
  })
  it('keeps favorites independent, clamps interests and is idempotent', () => {
    let profile = changeProfile(emptyProfile(), { type: 'favorite', id: 'game', tags: ['games', 'games'] })
    expect(profile.subscriptions).toEqual([])
    expect(profile.interests?.games).toBe(.15)
    profile = changeProfile(profile, { type: 'favorite', id: 'game', tags: ['games'] })
    expect(profile.interests?.games).toBe(.15)
    profile = changeProfile(profile, { type: 'interest', tags: ['games'], amount: 99 })
    expect(profile.interests?.games).toBe(1)
    profile = changeProfile(profile, { type: 'interest', tags: ['games'], amount: -99 })
    expect(profile.interests?.games).toBe(-1)
    const hidden = changeProfile(profile, { type: 'hide', id: 'game' })
    expect(hidden.favorites).toEqual(['game'])
    expect(profile.hidden).toEqual([])
  })
  it('sets and clears the synced week start preference', () => {
    let profile = changeProfile(emptyProfile(), {
      type: 'week-start',
      value: 'sunday',
    })
    expect(profile.settings?.weekStartsOn).toBe('sunday')
    profile = changeProfile(profile, { type: 'week-start' })
    expect(profile.settings?.weekStartsOn).toBeUndefined()
  })
})
