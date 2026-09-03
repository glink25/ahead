import { describe, expect, it } from 'vitest'
import { EventEditorState, FeedEditorState, ProfileEditorState } from './index.js'

const event = {
  id: 'launch',
  title: { 'zh-CN': '产品发布' },
  schedule: [{
    id: 'initial',
    value: { kind: 'exact' as const, date: '2026-09-10' },
    recordedAt: '2026-09-03T00:00:00Z',
  }],
}

describe('editor states', () => {
  it('validates an event from form and YAML modes', () => {
    const state = EventEditorState.fromEvent(event)
    expect(state.validate().ok).toBe(true)
    expect(state.setField('id', 'Bad ID').validate().ok).toBe(false)
    expect(state.setYaml(state.yaml.replace('Bad ID', 'valid-id')).validate().ok).toBe(true)
  })

  it('validates feeds and profiles', () => {
    const feed = new FeedEditorState({
      oefVersion: '0.1',
      kind: 'event-feed',
      id: 'minimal',
      name: { 'zh-CN': '最小订阅源' },
      events: [event],
    })
    const profile = new ProfileEditorState({
      oefVersion: '0.1',
      kind: 'user-data',
      id: 'me',
      displayName: { 'zh-CN': '我' },
    })
    expect(feed.validate().ok).toBe(true)
    expect(profile.validate().ok).toBe(true)
  })

  it('reports malformed YAML', () => {
    expect(EventEditorState.fromEvent(event).setYaml('title: [').validate().ok).toBe(false)
  })

  it('sets and clears duration through the form API', () => {
    const state = EventEditorState.fromEvent(event)
      .setDuration({ amount: 3, unit: 'days' })
    expect(state.toEvent().duration).toEqual({ amount: 3, unit: 'days' })
    expect(state.validate().ok).toBe(true)
    expect(state.setDuration(undefined).toEvent().duration).toBeUndefined()
  })
})
