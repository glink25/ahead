import { PageSkeleton } from '../../app/PageSkeleton'
import { profileName } from '../../lib/profile-name'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { previousUrl } from '../../app/navigation'
import { Plus } from 'lucide-react'
import { useNavigate, useSearchParams, useBlocker } from 'react-router'
import { useData, saveEvent } from '../../data/local'
import { personalEvents } from '../../data/model'
import { useEffect, useRef, useState } from 'react'
import { EventEditorState } from '@ahead/editor'
import type { Event } from '@ahead/schema'
import { pickText, pickLocalizedText, describeTemporal } from '../../lib/format'

const localInput = (date: Date, timed: boolean) => {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return timed
    ? day +
        'T' +
        String(date.getHours()).padStart(2, '0') +
        ':' +
        String(date.getMinutes()).padStart(2, '0')
    : day
}
export function fieldsFor(event: Event, locale: string) {
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
  if (
    event.duration &&
    (value?.kind === 'exact' || value?.kind === 'datetime')
  ) {
    const factor = {
      minutes: 60000,
      hours: 3600000,
      days: 86400000,
      weeks: 604800000,
    }[event.duration.unit]
    const date = new Date(start + (allDay ? 'T12:00:00' : ''))
    date.setTime(
      date.getTime() + event.duration.amount * factor - (allDay ? 86400000 : 0),
    )
    end = localInput(date, !allDay)
  }
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
  }
}
export function StudioPage() {
  useFeatureTranslations('studio')
  const { t, i18n } = useTranslation()

  const { db, ready } = useData()
  const [params] = useSearchParams()
  if (!ready || !db) return <PageSkeleton variant="editor" />
  const space = db.spaces[db.active]!
  const id = params.get('event')
  const event = id
    ? personalEvents(space.records).find((e) => e.id === id)
    : undefined
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
  const [identity] = useState(
    () => initial?.id ?? 'personal-' + crypto.randomUUID(),
  )
  useEffect(() => {
    if (!dirty) return
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
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
    () =>
      initial ?? {
        id: identity,
        title: { [contentLanguage]: '' },
        schedule: [
          {
            id: crypto.randomUUID(),
            value: { kind: 'exact', date: localInput(new Date(), false) },
            recordedAt: new Date().toISOString(),
          },
        ],
      },
  )
  const [fields, setFields] = useState(() => fieldsFor(base, contentLanguage))
  const [dateDirty, setDateDirty] = useState(false)
  const [mode, setMode] = useState<'form' | 'yaml'>('form')
  const [yaml, setYaml] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Event | null>(null)
  const [details, setDetails] = useState('')
  const update = (patch: Partial<typeof fields>) => {
    setDirty(true)
    setFields((f) => ({ ...f, ...patch }))
    setPreview(null)
    setErrors({})
  }
  const build = (validate = true): Event | null => {
    const next = structuredClone(base),
      issues: Record<string, string> = {}
    if (validate && !fields.title.trim()) issues.title = 'messages.enter_an_event_name'
    if (!fields.custom) {
      if (!fields.start || !Number.isFinite(new Date(fields.start).getTime()))
        issues.start = 'messages.choose_a_start_date'
      if (
        fields.end &&
        (new Date(fields.end).getTime() < new Date(fields.start).getTime() ||
          (!fields.allDay && fields.end === fields.start))
      )
        issues.end = 'messages.end_time_must_be_after_start_time'
    }
    if (Object.keys(issues).length) {
      setErrors(issues)
      return null
    }
    next.title = { ...next.title, [fields.titleLanguage]: fields.title.trim() }
    if (fields.notes.trim())
      next.description = { ...next.description, [fields.notesLanguage]: fields.notes.trim() }
    else if (next.description) {
      delete next.description[fields.notesLanguage]
      if (!Object.keys(next.description).length) delete next.description
    }
    if (dateDirty && !fields.custom) {
      const entry = next.schedule.find((item) => item.id === fields.entryId)!
      entry.value = fields.allDay
        ? { kind: 'exact', date: fields.start }
        : {
            kind: 'datetime',
            dateTime: new Date(fields.start).toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
      if (fields.end) {
        const amount = fields.allDay
          ? Math.round(
              (Date.parse(fields.end) - Date.parse(fields.start)) / 86400000,
            ) + 1
          : Math.round(
              (Date.parse(fields.end) - Date.parse(fields.start)) / 60000,
            )
        next.duration = { amount, unit: fields.allDay ? 'days' : 'minutes' }
      } else delete next.duration
    }
    if (!validate) return next
    const result = EventEditorState.fromEvent(next).validate()
    if (!result.ok) {
      setErrors({ form: 'messages.check_the_event_content_or_see_details_in_the_advanced_editor' })
      setDetails(
        result.message ??
          result.errors
            ?.map((e) => `${e.instancePath} ${e.message}`)
            .join('\n') ??
          '',
      )
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
      setDetails(
        result.message ??
          result.errors
            ?.map((e) => `${e.instancePath} ${e.message}`)
            .join('\n') ??
          '',
      )
      return null
    }
    setErrors({})
    return editor.toEvent()
  }
  const changeMode = () => {
    if (mode === 'form') {
      const event = build(false)
      if (!event) return
      setBase(event)
      setYaml(EventEditorState.fromEvent(event).yaml)
      setMode('yaml')
      setDateDirty(false)
    } else {
      const event = readYaml()
      if (!event) return
      setBase(event)
      setFields(fieldsFor(event, contentLanguage))
      setDateDirty(false)
      setMode('form')
    }
    setPreview(null)
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
        const destination = '/events/' + encodeURIComponent(event.id)
        if (initial && previousUrl() === destination) navigate(-1)
        else navigate(destination, { replace: true })
      }
    } catch (error) {
      setErrors({
        form:
          error instanceof Error
            ? error.message
            : 'messages.could_not_save_check_local_storage_and_retry',
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="studio-view">
      <div className="editor-heading">
        <div>
          <h1>{initial ? t('messages.edit_event') : t('messages.new_event')}</h1>
          <p className="muted">
            {name} · {privateRepo ? t('messages.private') : t('messages.public')}
          </p>
        </div>
        <button className="text-button" onClick={changeMode}>
          {mode === 'form' ? t('messages.advanced_editor') : t('messages.back_to_form')}
        </button>
      </div>
      {mode === 'form' ? (
        <div className="editor-form">
          <label className="event-title-label">
             {t('messages.event_name')} <input
              autoFocus
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'title-error' : undefined}
              placeholder={t('messages.what_are_you_looking_forward_to')}
              value={fields.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          {errors.title && (
            <p id="title-error" className="field-error">
              {displayMessage(errors.title)}
            </p>
          )}
          <div className="settings-group">
            {fields.custom ? (
              <div className="settings-body">
                 {t('messages.this_event_uses_a_custom_schedule_adjust_it_in_the_advanced_editor')} </div>
            ) : (
              <>
                <label className="setting-row">
                   {t('messages.all_day')} <input
                    role="switch"
                    type="checkbox"
                    checked={fields.allDay}
                    onChange={(e) => {
                      const allDay = e.target.checked
                      update({
                        allDay,
                        start: allDay
                          ? fields.start.slice(0, 10)
                          : fields.start + 'T09:00',
                        end: fields.end
                          ? allDay
                            ? fields.end.slice(0, 10)
                            : fields.end + 'T10:00'
                          : '',
                      })
                      setDateDirty(true)
                    }}
                  />
                </label>
                <label className="setting-row">
                   {t('messages.start')} <input
                    aria-label={t('messages.start')}
                    aria-invalid={Boolean(errors.start)}
                    type={fields.allDay ? 'date' : 'datetime-local'}
                    value={fields.start}
                    onChange={(e) => {
                      update({ start: e.target.value })
                      setDateDirty(true)
                    }}
                  />
                </label>
                {errors.start && <p className="field-error">{displayMessage(errors.start)}</p>}
                <label className="setting-row">
                   {t('messages.end_optional')} <input
                    aria-label={t('messages.end_optional')}
                    aria-invalid={Boolean(errors.end)}
                    type={fields.allDay ? 'date' : 'datetime-local'}
                    value={fields.end}
                    onChange={(e) => {
                      update({ end: e.target.value })
                      setDateDirty(true)
                    }}
                  />
                </label>
                {errors.end && <p className="field-error">{displayMessage(errors.end)}</p>}
                {!fields.allDay && (
                  <p className="editor-timezone">
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </p>
                )}
              </>
            )}
          </div>
          <details className="settings-group settings-disclosure">
            <summary>
               {t('messages.notes')} <Plus />
            </summary>
            <textarea
              aria-label={t('messages.notes')}
              placeholder={t('messages.add_notes')}
              value={fields.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </details>
        </div>
      ) : (
        <label className="yaml-editor">
           {t('messages.event_yaml')} <textarea
            aria-label={t('messages.event_yaml')}
            spellCheck={false}
            value={yaml}
            onChange={(e) => {
              setDirty(true)
              setYaml(e.target.value)
              setPreview(null)
            }}
          />
        </label>
      )}
      {errors.form && (
        <p className="field-error" role="alert">
          {displayMessage(errors.form)}
        </p>
      )}
      {errors.form && (
        <details className="technical-details">
          <summary>{t('messages.view_details')}</summary>
          <pre>{details}</pre>
        </details>
      )}
      <div className="editor-footer">
        <button
          className="primary-link"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? t('messages.saving') : t('messages.save')}
        </button>
        <button
          className="primary-link"
          onClick={() => {
            const event = mode === 'form' ? build() : readYaml()
            if (event) setPreview(event)
          }}
        >
           {t('messages.preview')} </button>
      </div>
      {blocker.state === 'blocked' && (
        <div className="confirm-backdrop">
          <section
            className="confirm-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t('messages.unsaved_event')}
          >
            <h2>{t('messages.this_event_has_not_been_saved')}</h2>
            <button
              className="primary-link"
              disabled={saving}
              onClick={() => void save(true)}
            >
               {t('messages.save_and_leave')} </button>
            <button
              onClick={() => {
                setDirty(false)
                allowLeave.current = true
                blocker.proceed()
              }}
            >
               {t('messages.discard_changes')} </button>
            <button onClick={() => blocker.reset()}>{t('messages.keep_editing')}</button>
          </section>
        </div>
      )}
      {preview && (
        <article className="event-preview" aria-label={t('messages.event_preview')}>
          <small>{t('messages.preview')}</small>
          <h2>{pickText(preview.title)}</h2>
          <p>
            {describeTemporal(
              [...preview.schedule].sort((a, b) =>
                b.recordedAt.localeCompare(a.recordedAt),
              )[0]!.value,
            )}
          </p>
          {preview.duration && (
            <p>
               {t('duration.' + preview.duration.unit, { count: preview.duration.amount })}
            </p>
          )}
          <p>{pickText(preview.description)}</p>
        </article>
      )}
    </section>
  )
}
