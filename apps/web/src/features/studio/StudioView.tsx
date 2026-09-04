import { useNavigate, useSearchParams } from 'react-router'
import { useData, saveEvent } from '../../data/local'
import { personalEvents } from '../../data/model'
import { useEffect, useState } from 'react'
import { EventEditorState } from '@ahead/editor'
import type { Event } from '@ahead/schema'
import { pickText, describeTemporal } from '../../lib/format'

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
function fieldsFor(event: Event) {
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
    title: pickText(event.title),
    notes: pickText(event.description),
    allDay,
    start,
    end,
    entryId: entry?.id,
    custom: value?.kind !== 'exact' && value?.kind !== 'datetime',
  }
}
export function StudioPage() {
  const { db, ready } = useData()
  const [params] = useSearchParams()
  if (!ready || !db) return <div className="empty-view">正在打开资料…</div>
  const space = db.spaces[db.active]!
  const id = params.get('event')
  const event = id
    ? personalEvents(space.records).find((e) => e.id === id)
    : undefined
  if (id && !event)
    return <div className="empty-view">没有找到可编辑的个人事件</div>
  return (
    <StudioEditor
      key={space.id + ':' + (id ?? 'new')}
      initial={event}
      spaceId={space.id}
      name={space.name}
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
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [leaving, setLeaving] = useState<string>()
  const [identity] = useState(
    () => initial?.id ?? 'personal-' + crypto.randomUUID(),
  )
  useEffect(() => {
    if (!dirty) return
    const click = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (
        anchor &&
        anchor.origin === location.origin &&
        anchor.pathname !== '/studio' &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault()
        e.stopPropagation()
        setLeaving(anchor.pathname + anchor.search)
      }
    }
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    document.addEventListener('click', click, true)
    window.addEventListener('beforeunload', unload)
    return () => {
      document.removeEventListener('click', click, true)
      window.removeEventListener('beforeunload', unload)
    }
  }, [dirty])
  const [base, setBase] = useState<Event>(
    () =>
      initial ?? {
        id: identity,
        title: { 'zh-CN': '' },
        schedule: [
          {
            id: crypto.randomUUID(),
            value: { kind: 'exact', date: localInput(new Date(), false) },
            recordedAt: new Date().toISOString(),
          },
        ],
      },
  )
  const [fields, setFields] = useState(() => fieldsFor(base))
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
    if (validate && !fields.title.trim()) issues.title = '请输入事件名称'
    if (!fields.custom) {
      if (!fields.start || !Number.isFinite(new Date(fields.start).getTime()))
        issues.start = '请选择开始日期'
      if (
        fields.end &&
        (new Date(fields.end).getTime() < new Date(fields.start).getTime() ||
          (!fields.allDay && fields.end === fields.start))
      )
        issues.end = '结束时间需晚于开始时间'
    }
    if (Object.keys(issues).length) {
      setErrors(issues)
      return null
    }
    next.title = { ...next.title, 'zh-CN': fields.title.trim() }
    if (fields.notes.trim())
      next.description = { ...next.description, 'zh-CN': fields.notes.trim() }
    else if (next.description) {
      delete next.description['zh-CN']
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
      setErrors({ form: '请检查事件内容，或在高级编辑中查看详情。' })
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
      setErrors({ form: '内容格式有误，请检查后重试。' })
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
      setFields(fieldsFor(event))
      setDateDirty(false)
      setMode('form')
    }
    setPreview(null)
  }
  const save = async (destination?: string) => {
    const event = mode === 'form' ? build() : readYaml()
    if (!event) return
    if (event.id !== identity) {
      setErrors({ form: '不能更改事件 ID' })
      return
    }
    setSaving(true)
    try {
      await saveEvent(spaceId, event, initial?.id)
      setDirty(false)
      navigate(destination ?? '/events/' + encodeURIComponent(event.id), {
        replace: !destination,
      })
    } catch (error) {
      setErrors({
        form:
          error instanceof Error
            ? error.message
            : '未能保存，请检查本机存储后重试',
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="studio-view">
      <div className="editor-heading">
        <div>
          <h1>{initial ? '编辑事件' : '新建事件'}</h1>
          <p className="muted">
            {name} · {privateRepo ? '私有' : '公开'}
          </p>
        </div>
        <button className="text-button" onClick={changeMode}>
          {mode === 'form' ? '高级编辑' : '返回表单'}
        </button>
      </div>
      {mode === 'form' ? (
        <div className="editor-form">
          <label className="event-title-label">
            事件名称
            <input
              autoFocus
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'title-error' : undefined}
              placeholder="有什么值得期待？"
              value={fields.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          {errors.title && (
            <p id="title-error" className="field-error">
              {errors.title}
            </p>
          )}
          <div className="settings-group">
            {fields.custom ? (
              <div className="settings-body">
                此事件使用自定义日期，可在高级编辑中调整。
              </div>
            ) : (
              <>
                <label className="setting-row">
                  全天
                  <input
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
                  开始
                  <input
                    aria-label="开始"
                    aria-invalid={Boolean(errors.start)}
                    type={fields.allDay ? 'date' : 'datetime-local'}
                    value={fields.start}
                    onChange={(e) => {
                      update({ start: e.target.value })
                      setDateDirty(true)
                    }}
                  />
                </label>
                {errors.start && <p className="field-error">{errors.start}</p>}
                <label className="setting-row">
                  结束（可选）
                  <input
                    aria-label="结束（可选）"
                    aria-invalid={Boolean(errors.end)}
                    type={fields.allDay ? 'date' : 'datetime-local'}
                    value={fields.end}
                    onChange={(e) => {
                      update({ end: e.target.value })
                      setDateDirty(true)
                    }}
                  />
                </label>
                {errors.end && <p className="field-error">{errors.end}</p>}
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
              备注<span>＋</span>
            </summary>
            <textarea
              aria-label="备注"
              placeholder="添加备注"
              value={fields.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </details>
        </div>
      ) : (
        <label className="yaml-editor">
          事件 YAML
          <textarea
            aria-label="事件 YAML"
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
          {errors.form}
        </p>
      )}
      {errors.form && (
        <details className="technical-details">
          <summary>查看详情</summary>
          <pre>{details}</pre>
        </details>
      )}
      <div className="editor-footer">
        <button
          className="primary-link"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          className="primary-link"
          onClick={() => {
            const event = mode === 'form' ? build() : readYaml()
            if (event) setPreview(event)
          }}
        >
          预览
        </button>
      </div>
      {leaving && (
        <div className="confirm-backdrop">
          <section
            className="confirm-panel"
            role="dialog"
            aria-modal="true"
            aria-label="未保存的事件"
          >
            <h2>事件尚未保存</h2>
            <button
              className="primary-link"
              disabled={saving}
              onClick={() => void save(leaving)}
            >
              保存并离开
            </button>
            <button
              onClick={() => {
                setDirty(false)
                navigate(leaving)
              }}
            >
              放弃更改
            </button>
            <button onClick={() => setLeaving(undefined)}>继续编辑</button>
          </section>
        </div>
      )}
      {preview && (
        <article className="event-preview" aria-label="事件预览">
          <small>预览</small>
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
              持续 {preview.duration.amount}{' '}
              {
                { minutes: '分钟', hours: '小时', days: '天', weeks: '周' }[
                  preview.duration.unit
                ]
              }
            </p>
          )}
          <p>{pickText(preview.description)}</p>
        </article>
      )}
    </section>
  )
}
