import { describe, expect, it } from 'vitest'
import { resolve } from '@ahead/resolver'
import { sourceKey } from '@ahead/protocol'
import { selectDiscover, selectMine } from './selectors'
import { emptyProfile } from './local-profile'
import { event, feed } from './test-fixtures'
describe('feed selectors', () => {
  it('discovery uses the market; mine unions subscribed manifests, favorites and pins', () => {
    const gaming = { locator: 'github:a/b', manifestPath: 'feeds/games.yaml' }
    const tech = { locator: 'github:a/b', manifestPath: 'feeds/tech.yaml' }
    const user = { ...emptyProfile(), subscriptions: [gaming], favorites: ['favorite'], pins: ['pinned'], hidden: ['hidden'] }
    const profile = resolve({ feeds: [
      { sourceLocator: sourceKey(gaming), feed: feed([event('game'), event('shared'), event('hidden')]) },
      { sourceLocator: sourceKey(tech), feed: feed([event('tech'), event('shared'), event('favorite'), event('pinned')]) },
      { sourceLocator: 'github:private/removed', feed: feed([event('delisted')]) },
    ], users: [user], activeProfile: 'local' })
    const market = new Set([sourceKey(gaming), sourceKey(tech)])
    expect(selectDiscover(profile, market).map((e) => e.id).sort()).toEqual(['favorite', 'game', 'pinned', 'shared', 'tech'])
    expect(selectMine(profile).map((e) => e.id).sort()).toEqual(['favorite', 'game', 'pinned', 'shared'])
    expect(profile.events.find((e) => e.id === 'shared')?.sourceLocators).toHaveLength(2)
  })
  it('mine is chronological with unknown last, never bucket-interleaved', () => {
    const user = { ...emptyProfile(), subscriptions: [{ locator: 'github:a/b' }] }
    const profile = resolve({ feeds: [{ sourceLocator: 'github:a/b', feed: feed([
      event('far', { kind: 'year', year: 2030 }), event('unknown', { kind: 'unknown' }),
      event('near', { kind: 'exact', date: '2027-01-02' }), event('next', { kind: 'exact', date: '2027-01-03' }),
    ]) }], users: [user], activeProfile: 'local' })
    expect(selectMine(profile, new Date('2027-01-01')).map((e) => e.id)).toEqual(['near', 'next', 'far', 'unknown'])
  })
})
