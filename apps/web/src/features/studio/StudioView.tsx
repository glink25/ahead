import { PageSkeleton } from '../../app/PageSkeleton'
import { profileName } from '../../lib/profile-name'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { previousUrl } from '../../app/navigation'
import { Check, Copy, ExternalLink, Plus } from 'lucide-react'
import { useNavigate, useSearchParams, useBlocker } from 'react-router'
import { useData, saveEvent } from '../../data/local'
import { personalEvents } from '../../data/model'
import { useEffect, useRef, useState } from 'react'
import { EventEditorState } from '@ahead/editor'
import { assertDurationFitsRecurrence } from '@ahead/resolver'
import type { Event, Recurrence } from '@ahead/schema'
import { pickLocalizedText } from '../../lib/format'
import { resourcePath } from '../../services/resource-address'

const OEF_DOCUMENTATION_URL =
  'https://github.com/glink25/ahead/blob/main/docs/protocol/README.md'

const localInput = (date: Date, timed: boolean) => {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return timed
    ? `${day}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : day
}

type FormRecurrenceFrequency =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'advanced'
type FormRecurrenceEnd = 'never' | 'until' | 'count'

export interface EventFormFields {
  title: string
  titleLanguage: string
  notes: string
  notesLanguage: string
  allDay: boolean
  start: string
  end: string
  entryId?: string
  custom: boolean
  recurrenceFrequency: FormRecurrenceFrequency
  recurrenceInterval: string
  recurrenceEnd: FormRecurrenceEnd
  recurrenceUntil: string
  recurrenceCount: string
  imageUrl: string
  imageAdvanced: boolean
}

export interface EventFormChanges {
  date: boolean
  recurrence: boolean
  image: boolean
}

function simpleRecurrence(recurrence: Recurrence | undefined): boolean {
  return Boolean(
    recurrence &&
      recurrence.freq !== 'custom' &&
      !recurrence.byMonth?.length &&
      !recurrence.byMonthDay?.length &&
      !(recurrence.count && recurrence.until),
  )
}

export function fieldsFor(event: Event, locale: string): EventFormFields {
  const entry = [...event.schedule].sort((a, b) =>
    b.recordedAt.localeCompare(a.recordedAt),
  )[0]
  const value = entry?.value
  const allDay = value?.kind !== 'datetime'
  const start =
    value?.kind === 'exact'
      ? value.date
      : value?.kind === 'datetime'
        ? localInput(new Date(value.dateTime), true)
        : localInput(new Date(), false)
  let end = ''
  if (event.duration && (value?.kind === 'exact' || value?.kind === 'datetime')) {
    const factor = {
      minutes: 60_000,
      hours: 3_600_000,
      days: 86_400_000,
      weeks: 604_800_000,
    }[event.duration.unit]
    const date = new Date(start + (allDay ? 'T12:00:00' : ''))
    date.setTime(date.getTime() + event.duration.amount * factor - (allDay ? 86_400_000 : 0))
    end = localInput(date, !allDay)
  }
  const recurrenceIsSimple = simpleRecurrence(event.recurrence)
  const image = event.media?.find((item) => (item.kind ?? 'image') === 'image')
  const imageIsEditable = !image || /^https:\/\//iu.test(image.path)
  return {
    title: pickLocalizedText(event.title, locale).text,
    titleLanguage: pickLocalizedText(event.title, locale).language,
    notes: pickLocalizedText(event.description, locale).text,
    notesLanguage: pickLocalizedText(event.description, locale).language,
    allDay,
    start,
    end,
    entryId: entry?.id,
    custom: value?.kind !== 'exact' && value?.kind !== 'datetime',
    recurrenceFrequency: !event.recurrence
      ? 'none'
      : recurrenceIsSimple
        ? (event.recurrence.freq as Exclude<FormRecurrenceFrequency, 'none' | 'advanced'>)
        : 'advanced',
    recurrenceInterval: String(event.recurrence?.interval ?? 1),
    recurrenceEnd: event.recurrence?.count
      ? 'count'
      : event.recurrence?.until
        ? 'until'
        : 'never',
    recurrenceUntil: event.recurrence?.until ?? '',
    recurrenceCount: String(event.recurrence?.count ?? 1),
    imageUrl: imageIsEditable ? (image?.path ?? '') : '',
    imageAdvanced: !imageIsEditable,
  }
}

export function applyEventForm(
  event: Event,
  fields: EventFormFields,
  changes: EventFormChanges,
): Event {
  const next = structuredClone(event)
  next.title = { ...next.title, [fields.titleLanguage]: fields.title.trim() }
  if (fields.notes.trim())
    next.description = { ...next.description, [fields.notesLanguage]: fields.notes.trim() }
  else if (next.description) {
    delete next.description[fields.notesLanguage]
    if (!Object.keys(next.description).length) delete next.description
  }
  if (changes.date && !fields.custom) {
    const entry = next.schedule.find((item) => item.id === fields.entryId)
    if (entry) {
      entry.value = fields.allDay
        ? { kind: 'exact', date: fields.start }
        : {
            kind: 'datetime',
            dateTime: new Date(fields.start).toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
    }
    if (fields.end) {
      const amount = fields.allDay
        ? Math.round((Date.parse(fields.end) - Date.parse(fields.start)) / 86_400_000) + 1
        : Math.round((Date.parse(fields.end) - Date.parse(fields.start)) / 60_000)
      next.duration = { amount, unit: fields.allDay ? 'days' : 'minutes' }
    } else delete next.duration
  }
  if (changes.recurrence) {
    if (fields.recurrenceFrequency === 'none') delete next.recurrence
    else if (fields.recurrenceFrequency !== 'advanced') {
      next.recurrence = {
        freq: fields.recurrenceFrequency,
        interval: Number(fields.recurrenceInterval),
        ...(fields.recurrenceEnd === 'until'
          ? { until: fields.recurrenceUntil }
          : fields.recurrenceEnd === 'count'
            ? { count: Number(fields.recurrenceCount) }
            : {}),
        ...(!fields.allDay
          ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          : {}),
      }
    }
  }
  if (changes.image) {
    const media = [...(next.media ?? [])]
    const imageIndex = media.findIndex((item) => (item.kind ?? 'image') === 'image')
    const path = fields.imageUrl.trim()
    if (!path && imageIndex >= 0) media.splice(imageIndex, 1)
    else if (path) {
      const image = {
        ...(imageIndex >= 0 ? media[imageIndex] : {}),
        path,
        kind: 'image' as const,
      }
      if (imageIndex >= 0) media[imageIndex] = image
      else media.unshift(image)
    }
    if (media.length) next.media = media
    else delete next.media
  }
  return next
}

export function aiPromptFor(locale: string): string {
  if (locale.toLowerCase().startsWith('zh'))
    return `请根据 Ahead OEF v0.1 事件规范（${OEF_DOCUMENTATION_URL}），为【在此描述事件主题】创建一个单独的 Event YAML 对象，而不是完整的 EventFeed。请使用可靠、可核实的日期；根据需要使用 duration、recurrence 和 media 等字段；确保结果符合规范。只返回可直接粘贴到 Ahead 高级编辑器的 YAML，不要使用 Markdown 代码围栏，也不要添加解释。`
  return `Following the Ahead OEF v0.1 event specification (${OEF_DOCUMENTATION_URL}), create one Event YAML object for [describe the event topic here], not a complete EventFeed. Use reliable, verifiable dates; use fields such as duration, recurrence, and media when appropriate; and ensure the result conforms to the specification. Return only YAML that can be pasted directly into Ahead's advanced editor, without Markdown fences or explanation.`
}

export function validateEventForm(fields: EventFormFields): Record<string, string> {
  const issues: Record<string, string> = {}
  if (!fields.title.trim()) issues.title = 'messages.enter_an_event_name'
  if (!fields.custom) {
    if (!fields.start || !Number.isFinite(new Date(fields.start).getTime()))
      issues.start = 'messages.choose_a_start_date'
    if (
      fields.end &&
      (new Date(fields.end).getTime() < new Date(fields.start).getTime() ||
        (!fields.allDay && fields.end === fields.start))
    ) issues.end = 'messages.end_time_must_be_after_start_time'
  }
  if (fields.recurrenceFrequency !== 'none' && fields.recurrenceFrequency !== 'advanced') {
    const interval = Number(fields.recurrenceInterval)
    if (!Number.isInteger(interval) || interval < 1)
      issues.recurrence = 'messages.repeat_interval_must_be_at_least_one'
    if (
      fields.recurrenceEnd === 'count' &&
      (!Number.isInteger(Number(fields.recurrenceCount)) ||
        Number(fields.recurrenceCount) < 1 ||
        Number(fields.recurrenceCount) > 500)
    ) issues.recurrence = 'messages.repeat_count_must_be_between_1_and_500'
    if (
      fields.recurrenceEnd === 'until' &&
      (!fields.recurrenceUntil || fields.recurrenceUntil < fields.start.slice(0, 10))
    ) issues.recurrence = 'messages.repeat_end_cannot_be_before_start'
  }
  if (fields.imageUrl.trim()) {
    try {
      if (new URL(fields.imageUrl.trim()).protocol !== 'https:')
        issues.image = 'messages.image_link_must_use_https'
    } catch {
      issues.image = 'messages.enter_a_valid_image_link'
    }
  }
  return issues
}

export function StudioPage() {
  useFeatureTranslations('studio')
  const { t } = useTranslation()
  const { db, ready } = useData()
  const [params] = useSearchParams()
  if (!ready || !db) return <PageSkeleton variant="editor" />
  const space = db.spaces[db.active]!
  const id = params.get('event')
  const event = id ? personalEvents(space.records).find((item) => item.id === id) : undefined
  if (id && !event)
    return <div className="empty-view">{t('messages.no_editable_personal_event_found')}</div>
  return (
    <StudioEditor
      key={space.id + ':' + (id ?? 'new')}
      initial={event}
      spaceId={space.id}
      name={profileName(space)}
      privateRepo={space.private}
    />
  )
}

function StudioEditor({
  initial,
  spaceId,
  name,
  privateRepo,
}: {
  initial?: Event
  spaceId: string
  name: string
  privateRepo: boolean
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const allowLeave = useRef(false)
  const blocker = useBlocker(() => dirty && !allowLeave.current)
  const [identity] = useState(() => initial?.id ?? 'personal-' + crypto.randomUUID())
  useEffect(() => {
    if (!dirty) return
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const reset = () => window.removeEventListener('beforeunload', unload)
    window.addEventListener('ahead-reset', reset)
    window.addEventListener('beforeunload', unload)
    return () => {
      window.removeEventListener('ahead-reset', reset)
      window.removeEventListener('beforeunload', unload)
    }
  }, [dirty])
  const [contentLanguage] = useState(() => i18n.resolvedLanguage || 'en')
  const [base, setBase] = useState<Event>(
    () => initial ?? {
      id: identity,
      title: { [contentLanguage]: '' },
      schedule: [{
        id: crypto.randomUUID(),
        value: { kind: 'exact', date: localInput(new Date(), false) },
        recordedAt: new Date().toISOString(),
      }],
    },
  )
  const [fields, setFields] = useState(() => fieldsFor(base, contentLanguage))
  const [changes, setChanges] = useState<EventFormChanges>({
    date: false,
    recurrence: false,
    image: false,
  })
  const [mode, setMode] = useState<'form' | 'yaml'>('form')
  const [yaml, setYaml] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [details, setDetails] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')

  const update = (patch: Partial<EventFormFields>, changed?: keyof EventFormChanges) => {
    setDirty(true)
    setFields((current) => ({ ...current, ...patch }))
    if (changed) setChanges((current) => ({ ...current, [changed]: true }))
    setErrors({})
  }
  const build = (validate = true): Event | null => {
    const issues = validateEventForm(fields)
    if (validate && Object.keys(issues).length) {
      setErrors(issues)
      return null
    }
    const next = applyEventForm(base, fields, changes)
    if (!validate) return next
    const result = EventEditorState.fromEvent(next).validate()
    if (!result.ok) {
      setErrors({ form: 'messages.check_the_event_content_or_see_details_in_the_advanced_editor' })
      setDetails(result.message ?? result.errors?.map((error) => `${error.instancePath} ${error.message}`).join('\n') ?? '')
      return null
    }
    try {
      assertDurationFitsRecurrence(next.duration, next.recurrence)
    } catch (error) {
      setErrors({ recurrence: 'messages.event_duration_must_be_shorter_than_repeat_interval' })
      setDetails(error instanceof Error ? error.message : '')
      return null
    }
    setErrors({})
    return next
  }
  const readYaml = () => {
    const editor = EventEditorState.fromEvent(base).setYaml(yaml)
    const result = editor.validate()
    if (!result.ok) {
      setErrors({ form: 'messages.invalid_content_format_check_it_and_retry' })
      setDetails(result.message ?? result.errors?.map((error) => `${error.instancePath} ${error.message}`).join('\n') ?? '')
      return null
    }
    const event = editor.toEvent()
    try {
      assertDurationFitsRecurrence(event.duration, event.recurrence)
    } catch (error) {
      setErrors({ form: 'messages.event_duration_must_be_shorter_than_repeat_interval' })
      setDetails(error instanceof Error ? error.message : '')
      return null
    }
    setErrors({})
    return event
  }
  const changeMode = () => {
    if (mode === 'form') {
      const event = build(false)
      if (!event) return
      setBase(event)
      setYaml(EventEditorState.fromEvent(event).yaml)
      setMode('yaml')
    } else {
      const event = readYaml()
      if (!event) return
      setBase(event)
      setFields(fieldsFor(event, contentLanguage))
      setMode('form')
    }
    setChanges({ date: false, recurrence: false, image: false })
    setCopyState('idle')
  }
  const save = async (leave = false) => {
    const event = mode === 'form' ? build() : readYaml()
    if (!event) return
    if (event.id !== identity) {
      setErrors({ form: 'messages.cannot_change_the_event_id' })
      return
    }
    setSaving(true)
    try {
      await saveEvent(spaceId, event, initial?.id)
      setDirty(false)
      allowLeave.current = true
      if (leave && blocker.state === 'blocked') blocker.proceed()
      else {
        const destination = resourcePath('event', { scheme: 'local', spaceId }, event.id)
        if (initial && previousUrl() === destination) navigate(-1)
        else navigate(destination, { replace: true })
      }
    } catch (error) {
      setErrors({
        form: error instanceof Error
          ? error.message
          : 'messages.could_not_save_check_local_storage_and_retry',
      })
    } finally {
      setSaving(false)
    }
  }
  const copyAiPrompt = async () => {
    const prompt = aiPromptFor(i18n.resolvedLanguage || 'en')
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('manual')
    }
  }

  const recurrenceVisible = fields.recurrenceFrequency !== 'none' && fields.recurrenceFrequency !== 'advanced'
  return (
    <section className="max-w-[680px]!">
      <div className="mb-7 flex items-center justify-between gap-4 max-[600px]:mb-[18px]">
        <div>
          <h1>{initial ? t('messages.edit_event') : t('messages.new_event')}</h1>
          <p className="muted">{name} · {privateRepo ? t('messages.private') : t('messages.public')}</p>
        </div>
        <button className="text-button" onClick={changeMode}>
          {mode === 'form' ? t('messages.advanced_editor') : t('messages.back_to_form')}
        </button>
      </div>
      {mode === 'form' ? (
        <div className="grid gap-5 [&_.setting-row]:max-[600px]:text-[13px] [&_.setting-row_input:not([type=checkbox])]:min-w-0 [&_.setting-row_input:not([type=checkbox])]:max-w-[65%] [&_.setting-row_input:not([type=checkbox])]:rounded-lg [&_.setting-row_input:not([type=checkbox])]:border-0 [&_.setting-row_input:not([type=checkbox])]:bg-surface [&_.setting-row_input:not([type=checkbox])]:p-2 [&_.setting-row_input:not([type=checkbox])]:text-sm max-[600px]:[&_.setting-row_input:not([type=checkbox])]:text-xs">
          <label className="text-xs text-muted [&_input]:block [&_input]:w-full [&_input]:rounded-none [&_input]:border-0 [&_input]:border-b [&_input]:border-line [&_input]:bg-transparent [&_input]:px-0 [&_input]:py-4 [&_input]:text-2xl [&_input]:font-medium [&_input]:text-ink max-[600px]:[&_input]:text-[22px]">
            {t('messages.event_name')}
            <input
              autoFocus
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'title-error' : undefined}
              placeholder={t('messages.what_are_you_looking_forward_to')}
              value={fields.title}
              onChange={(event) => update({ title: event.target.value })}
            />
          </label>
          {errors.title && <p id="title-error" className="field-error">{displayMessage(errors.title)}</p>}

          <section className="grid gap-[9px] [&>h2]:m-0! [&>h2]:px-1 [&>h2]:text-[13px]! [&>h2]:font-medium! [&>h2]:text-muted" aria-labelledby="event-time-heading">
            <h2 id="event-time-heading">{t('messages.time')}</h2>
            <div className="settings-group">
              {fields.custom ? (
                <div className="settings-body px-5 py-3.5 text-xs leading-[1.55] text-muted">
                  {t('messages.this_event_uses_a_custom_schedule_adjust_it_in_the_advanced_editor')}
                </div>
              ) : (
                <>
                  <label className="setting-row">
                    {t('messages.all_day')}
                    <input
                      role="switch"
                      type="checkbox"
                      checked={fields.allDay}
                      onChange={(event) => {
                        const allDay = event.target.checked
                        update({
                          allDay,
                          start: allDay ? fields.start.slice(0, 10) : fields.start + 'T09:00',
                          end: fields.end
                            ? allDay ? fields.end.slice(0, 10) : fields.end + 'T10:00'
                            : '',
                        }, 'date')
                      }}
                    />
                  </label>
                  <label className="setting-row">
                    {t('messages.start')}
                    <input
                      aria-label={t('messages.start')}
                      aria-invalid={Boolean(errors.start)}
                      type={fields.allDay ? 'date' : 'datetime-local'}
                      value={fields.start}
                      onChange={(event) => update({ start: event.target.value }, 'date')}
                    />
                  </label>
                  {errors.start && <p className="field-error">{displayMessage(errors.start)}</p>}
                  <label className="setting-row">
                    {t('messages.end_optional')}
                    <input
                      aria-label={t('messages.end_optional')}
                      aria-invalid={Boolean(errors.end)}
                      type={fields.allDay ? 'date' : 'datetime-local'}
                      value={fields.end}
                      onChange={(event) => update({ end: event.target.value }, 'date')}
                    />
                  </label>
                  {errors.end && <p className="field-error">{displayMessage(errors.end)}</p>}
                  {!fields.allDay && <p className="px-5 py-2 text-[11px] text-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>}
                </>
              )}
            </div>
          </section>

          <section className="grid gap-[9px] [&>h2]:m-0! [&>h2]:px-1 [&>h2]:text-[13px]! [&>h2]:font-medium! [&>h2]:text-muted" aria-labelledby="event-repeat-heading">
            <h2 id="event-repeat-heading">{t('messages.repeat')}</h2>
            <div className="settings-group">
              <label className="setting-row">
                {t('messages.repeat')}
                <select
                  aria-label={t('messages.repeat')}
                  value={fields.recurrenceFrequency}
                  onChange={(event) => update({
                    recurrenceFrequency: event.target.value as FormRecurrenceFrequency,
                  }, 'recurrence')}
                >
                  {fields.recurrenceFrequency === 'advanced' && (
                    <option value="advanced">{t('messages.advanced_repeat_rule')}</option>
                  )}
                  <option value="none">{t('messages.does_not_repeat')}</option>
                  <option value="daily">{t('messages.daily')}</option>
                  <option value="weekly">{t('messages.weekly')}</option>
                  <option value="monthly">{t('messages.monthly')}</option>
                  <option value="yearly">{t('messages.yearly')}</option>
                </select>
              </label>
              {fields.recurrenceFrequency === 'advanced' && (
                <p className="px-5 py-3.5 text-xs leading-[1.55] text-muted">{t('messages.advanced_repeat_rule_is_preserved')}</p>
              )}
              {recurrenceVisible && (
                <>
                  <label className="setting-row">
                    {t('messages.repeat_every')}
                    <span className="inline-flex items-center justify-end gap-2 text-xs text-muted [&_input]:w-[76px]">
                      <input
                        aria-label={t('messages.repeat_interval')}
                        type="number"
                        min="1"
                        step="1"
                        value={fields.recurrenceInterval}
                        onChange={(event) => update({ recurrenceInterval: event.target.value }, 'recurrence')}
                      />
                      {t(`messages.repeat_unit_${fields.recurrenceFrequency}`)}
                    </span>
                  </label>
                  <label className="setting-row">
                    {t('messages.ends')}
                    <select
                      aria-label={t('messages.ends')}
                      value={fields.recurrenceEnd}
                      onChange={(event) => update({
                        recurrenceEnd: event.target.value as FormRecurrenceEnd,
                      }, 'recurrence')}
                    >
                      <option value="never">{t('messages.never')}</option>
                      <option value="until">{t('messages.on_date')}</option>
                      <option value="count">{t('messages.after_count')}</option>
                    </select>
                  </label>
                  {fields.recurrenceEnd === 'until' && (
                    <label className="setting-row">
                      {t('messages.repeat_end_date')}
                      <input
                        aria-label={t('messages.repeat_end_date')}
                        type="date"
                        value={fields.recurrenceUntil}
                        onChange={(event) => update({ recurrenceUntil: event.target.value }, 'recurrence')}
                      />
                    </label>
                  )}
                  {fields.recurrenceEnd === 'count' && (
                    <label className="setting-row">
                      {t('messages.occurrences')}
                      <input
                        aria-label={t('messages.occurrences')}
                        type="number"
                        min="1"
                        max="500"
                        step="1"
                        value={fields.recurrenceCount}
                        onChange={(event) => update({ recurrenceCount: event.target.value }, 'recurrence')}
                      />
                    </label>
                  )}
                </>
              )}
              {errors.recurrence && <p className="field-error">{displayMessage(errors.recurrence)}</p>}
            </div>
          </section>

          <details className="settings-group settings-disclosure mt-0">
            <summary>{t('messages.notes')} <Plus /></summary>
            <textarea
              aria-label={t('messages.notes')}
              placeholder={t('messages.add_notes')}
              value={fields.notes}
              onChange={(event) => update({ notes: event.target.value })}
            />
          </details>

          <details className="settings-group settings-disclosure mt-0">
            <summary>{t('messages.event_image')} <Plus /></summary>
            {fields.imageAdvanced && !changes.image && (
              <p className="px-5 py-3.5 text-xs leading-[1.55] text-muted">{t('messages.advanced_image_is_preserved')}</p>
            )}
            <label className="grid gap-2 px-5 pb-5 text-xs text-muted [&_input]:w-full [&_input]:rounded-[10px] [&_input]:border-0 [&_input]:bg-surface [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-ink">
              {t('messages.image_link')}
              <input
                aria-label={t('messages.image_link')}
                aria-invalid={Boolean(errors.image)}
                type="url"
                inputMode="url"
                placeholder="https://example.com/image.jpg"
                value={fields.imageUrl}
                onChange={(event) => update({ imageUrl: event.target.value }, 'image')}
              />
            </label>
            {errors.image && <p className="field-error">{displayMessage(errors.image)}</p>}
          </details>
        </div>
      ) : (
        <div className="block text-[13px] text-muted [&>textarea]:mt-2.5 [&>textarea]:block [&>textarea]:min-h-[340px] [&>textarea]:w-full [&>textarea]:rounded-xl [&>textarea]:border [&>textarea]:border-line [&>textarea]:bg-panel [&>textarea]:p-4 [&>textarea]:font-mono [&>textarea]:text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span>{t('messages.event_yaml')}</span>
            <div className="flex flex-wrap items-center justify-end gap-3 [&_.text-button]:inline-flex [&_.text-button]:items-center [&_.text-button]:gap-[5px] [&_.text-button]:text-xs [&_svg]:size-3.5">
              <a
                className="text-button"
                href={OEF_DOCUMENTATION_URL}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink /> {t('messages.view_oef_documentation')}
              </a>
              <button className="text-button" onClick={() => void copyAiPrompt()}>
                {copyState === 'copied' ? <Check /> : <Copy />}
                {copyState === 'copied'
                  ? t('messages.ai_prompt_copied')
                  : t('messages.copy_ai_creation_prompt')}
              </button>
            </div>
          </div>
          <textarea
            aria-label={t('messages.event_yaml')}
            spellCheck={false}
            value={yaml}
            onChange={(event) => {
              setDirty(true)
              setYaml(event.target.value)
              setErrors({})
            }}
          />
          {copyState === 'manual' && (
            <label className="mt-3.5 grid gap-2 [&_textarea]:mt-0 [&_textarea]:min-h-[120px] [&_textarea]:font-sans">
              {t('messages.copy_prompt_manually')}
              <textarea
                readOnly
                value={aiPromptFor(i18n.resolvedLanguage || 'en')}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </div>
      )}
      {errors.form && <p className="field-error" role="alert">{displayMessage(errors.form)}</p>}
      {(errors.form || (errors.recurrence && details)) && details && (
        <details className="technical-details">
          <summary>{t('messages.view_details')}</summary>
          <pre>{details}</pre>
        </details>
      )}
      <div className="mt-6 flex items-center justify-end gap-3 [&>span]:text-xs [&>span]:text-muted">
        <button className="primary-link" disabled={saving} onClick={() => void save()}>
          {saving ? t('messages.saving') : t('messages.save')}
        </button>
      </div>
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-60 grid place-items-center bg-[#0007] p-6">
          <section
            className="grid min-w-[280px] gap-[18px] rounded-[20px] bg-panel p-6 shadow-[0_20px_60px_#0004] [&_h2]:text-xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('messages.unsaved_event')}
          >
            <h2>{t('messages.this_event_has_not_been_saved')}</h2>
            <button className="primary-link" disabled={saving} onClick={() => void save(true)}>
              {t('messages.save_and_leave')}
            </button>
            <button onClick={() => {
              setDirty(false)
              allowLeave.current = true
              blocker.proceed()
            }}>
              {t('messages.discard_changes')}
            </button>
            <button onClick={() => blocker.reset()}>{t('messages.keep_editing')}</button>
          </section>
        </div>
      )}
    </section>
  )
}
