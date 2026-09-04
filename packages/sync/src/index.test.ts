import { describe, it, expect } from 'vitest'
import {
  newDatabase,
  applyChanges,
  mergeRecords,
  entries,
  LocalDatabase,
  recordKey,
  type Database,
} from './index'
describe('local-first records', () => {
  it('converges deterministically, including deletion and restoration', () => {
    const a = newDatabase()
    a.device = 'a'
    const b = newDatabase()
    b.device = 'b'
    applyChanges(
      a,
      a.spaces.guest!,
      [{ collection: 'events', key: 'one', value: { title: 'first' } }],
      100,
    )
    b.spaces.guest!.records = structuredClone(a.spaces.guest!.records)
    applyChanges(
      a,
      a.spaces.guest!,
      [{ collection: 'events', key: 'one', value: { title: 'edit' } }],
      200,
    )
    applyChanges(
      b,
      b.spaces.guest!,
      [{ collection: 'events', key: 'one', deleted: true }],
      300,
    )
    const merged = mergeRecords(
      a.spaces.guest!.records,
      b.spaces.guest!.records,
    )
    expect(merged).toEqual(
      mergeRecords(b.spaces.guest!.records, a.spaces.guest!.records),
    )
    expect(entries(merged, 'events')).toEqual([])
    a.spaces.guest!.records = merged
    applyChanges(
      a,
      a.spaces.guest!,
      [{ collection: 'events', key: 'one', value: { title: 'restored' } }],
      50,
    )
    expect(entries(a.spaces.guest!.records, 'events')).toEqual([
      ['one', { title: 'restored' }],
    ])
    expect(mergeRecords(merged, merged)).toEqual(merged)
  })
  it('keeps only the current pending revision and 20 recoverable predecessors', () => {
    const db = newDatabase(),
      s = db.spaces.guest!
    for (let i = 0; i < 100; i++)
      applyChanges(db, s, [{ collection: 'settings', key: 'x', value: i }], i)
    expect(s.pending).toHaveLength(1)
    expect(s.records[recordKey('settings', 'x')]!.history).toHaveLength(20)
  })
  it('does not report or publish a failed local transaction', async () => {
    let persisted: Database | undefined
    let fail = false
    const client = new LocalDatabase({
      read: async () => persisted,
      update: async (change) => {
        const next = change(structuredClone(persisted))
        if (fail) throw new Error('quota')
        persisted = next
        return next
      },
    }).register('events', () => true)
    await client.transaction(() => {})
    fail = true
    await expect(
      client.mutate('guest', [
        { collection: 'events', key: 'x', value: 'value' },
      ]),
    ).rejects.toThrow('quota')
    expect(persisted!.spaces.guest!.pending).toHaveLength(0)
    expect(persisted!.spaces.guest!.records).toEqual({})
  })
})
