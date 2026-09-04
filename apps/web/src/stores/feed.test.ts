import { expect, it } from 'vitest'
import { newDatabase, newSpace, applyChanges } from '@ahead/sync'
import { emptyProfile } from '../lib/local-profile'
import { materializeProfile, profileChanges, personalEvents } from '../data/model'
it('isolates profile preferences and event records while retaining standard UserData', () => {
  const db = newDatabase()
  db.spaces.other = newSpace('other', 'Other', false)
  applyChanges(db, db.spaces.guest!, profileChanges({ ...emptyProfile(), favorites: ['only-here'] }))
  applyChanges(db, db.spaces.other, profileChanges({ ...emptyProfile(), favorites: ['other'] }))
  expect(materializeProfile(db.spaces.guest!.records).favorites).toEqual(['only-here'])
  expect(materializeProfile(db.spaces.other.records).favorites).toEqual(['other'])
  expect(personalEvents(db.spaces.other.records)).toEqual([])
})
