import { describe, expect, it } from 'vitest'
import type { Event } from '@ahead/schema'
import {
  aiPromptFor,
  applyEventForm,
  fieldsFor,
  validateEventForm,
} from './StudioView'

const baseEvent = (): Event => ({
  id: 'conference',
  title: { en: 'Conference', 'zh-CN': '会议' },
  description: { en: 'Original notes', 'zh-CN': '原备注' },
  schedule: [{
    id: 'announced',
    value: { kind: 'exact', date: '2027-05-10' },
    recordedAt: '2027-01-01T00:00:00Z',
  }],
  evidence: [{ kind: 'url', value: 'https://example.com/source' }],
  extensions: { keep: true },
  media: [{ kind: 'video', path: 'https://example.com/trailer.mp4' }],
})

describe('event form mapping', () => {
  it('maps an all-day range, localized notes, recurrence and image without losing advanced fields', () => {
    const event = baseEvent()
    const fields = fieldsFor(event, 'en')
    const result = applyEventForm(event, {
      ...fields,
      title: 'Updated conference',
      notes: 'Updated notes',
      start: '2027-05-11',
      end: '2027-05-13',
      recurrenceFrequency: 'weekly',
      recurrenceInterval: '2',
      recurrenceEnd: 'count',
      recurrenceCount: '8',
      imageUrl: 'https://example.com/cover.jpg',
    }, { date: true, recurrence: true, image: true })

    expect(result.title).toEqual({ en: 'Updated conference', 'zh-CN': '会议' })
    expect(result.description).toEqual({ en: 'Updated notes', 'zh-CN': '原备注' })
    expect(result.schedule[0]!.value).toEqual({ kind: 'exact', date: '2027-05-11' })
    expect(result.duration).toEqual({ amount: 3, unit: 'days' })
    expect(result.recurrence).toEqual({ freq: 'weekly', interval: 2, count: 8 })
    expect(result.media).toEqual([
      { path: 'https://example.com/cover.jpg', kind: 'image' },
      { kind: 'video', path: 'https://example.com/trailer.mp4' },
    ])
    expect(result.evidence).toEqual(event.evidence)
    expect(result.extensions).toEqual({ keep: true })
  })

  it.each(['daily', 'weekly', 'monthly', 'yearly'] as const)(
    'round-trips the %s recurrence frequency',
    (frequency) => {
      const event = baseEvent()
      const fields = fieldsFor(event, 'en')
      const result = applyEventForm(event, {
        ...fields,
        recurrenceFrequency: frequency,
        recurrenceInterval: '3',
        recurrenceEnd: 'until',
        recurrenceUntil: '2028-05-10',
      }, { date: false, recurrence: true, image: false })
      expect(result.recurrence).toMatchObject({
        freq: frequency,
        interval: 3,
        until: '2028-05-10',
      })
      expect(fieldsFor(result, 'en').recurrenceFrequency).toBe(frequency)
    },
  )

  it('preserves advanced recurrence and relative media until explicitly replaced', () => {
    const event: Event = {
      ...baseEvent(),
      recurrence: { freq: 'custom', interval: 2, byMonth: [5] },
      media: [
        { kind: 'image', path: 'assets/cover.jpg', alt: { en: 'Cover' } },
        { kind: 'audio', path: 'assets/theme.mp3' },
      ],
    }
    const fields = fieldsFor(event, 'en')
    expect(fields.recurrenceFrequency).toBe('advanced')
    expect(fields.imageAdvanced).toBe(true)
    expect(applyEventForm(event, { ...fields, title: 'Changed' }, {
      date: false,
      recurrence: false,
      image: false,
    })).toMatchObject({ recurrence: event.recurrence, media: event.media })

    const replaced = applyEventForm(event, {
      ...fields,
      recurrenceFrequency: 'monthly',
      recurrenceEnd: 'never',
      imageUrl: 'https://example.com/new.jpg',
    }, { date: false, recurrence: true, image: true })
    expect(replaced.recurrence).toEqual({ freq: 'monthly', interval: 2 })
    expect(replaced.media).toEqual([
      { kind: 'image', path: 'https://example.com/new.jpg', alt: { en: 'Cover' } },
      { kind: 'audio', path: 'assets/theme.mp3' },
    ])
  })

  it('removes only the managed image and supports timed events', () => {
    const event: Event = {
      ...baseEvent(),
      media: [
        { kind: 'image', path: 'https://example.com/old.jpg' },
        { kind: 'video', path: 'https://example.com/video.mp4' },
      ],
    }
    const fields = fieldsFor(event, 'en')
    const result = applyEventForm(event, {
      ...fields,
      allDay: false,
      start: '2027-05-10T09:30',
      end: '2027-05-10T11:00',
      imageUrl: '',
    }, { date: true, recurrence: false, image: true })
    expect(result.schedule[0]!.value.kind).toBe('datetime')
    expect(result.duration).toEqual({ amount: 90, unit: 'minutes' })
    expect(result.media).toEqual([{ kind: 'video', path: 'https://example.com/video.mp4' }])
  })
})

describe('event form validation and AI prompt', () => {
  const validFields = () => fieldsFor(baseEvent(), 'en')

  it('rejects invalid image, recurrence bounds and repeat end dates', () => {
    expect(validateEventForm({ ...validFields(), imageUrl: 'http://example.com/a.jpg' }).image)
      .toBe('messages.image_link_must_use_https')
    expect(validateEventForm({
      ...validFields(),
      recurrenceFrequency: 'daily',
      recurrenceInterval: '0',
    }).recurrence).toBe('messages.repeat_interval_must_be_at_least_one')
    expect(validateEventForm({
      ...validFields(),
      recurrenceFrequency: 'daily',
      recurrenceEnd: 'count',
      recurrenceCount: '501',
    }).recurrence).toBe('messages.repeat_count_must_be_between_1_and_500')
    expect(validateEventForm({
      ...validFields(),
      recurrenceFrequency: 'daily',
      recurrenceEnd: 'until',
      recurrenceUntil: '2027-05-01',
    }).recurrence).toBe('messages.repeat_end_cannot_be_before_start')
  })

  it('creates localized generic prompts without embedding a draft', () => {
    const zh = aiPromptFor('zh-CN')
    const en = aiPromptFor('en')
    for (const prompt of [zh, en]) {
      expect(prompt).toContain('https://github.com/glink25/ahead/blob/main/docs/protocol/README.md')
      expect(prompt).toContain('Event YAML')
      expect(prompt).toContain('EventFeed')
      expect(prompt).not.toContain('id: conference')
    }
    expect(zh).toContain('不要使用 Markdown')
    expect(en).toContain('without Markdown fences')
  })
})
