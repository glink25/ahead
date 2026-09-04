import { useMemo, useState } from 'react'
import { EventEditorState } from '@ahead/editor'
import { Alert, Button, Card, Input, TextArea } from '@ahead/ui'
export function StudioPage() {
  const initial = useMemo(() => EventEditorState.fromEvent({
    id: 'new-event',
    title: { 'zh-CN': '新的盼头' },
    schedule: [{
      id: 'initial',
      value: { kind: 'exact', date: new Date().toISOString().slice(0, 10) },
      recordedAt: new Date().toISOString(),
    }],
  }), [])
  const [editor] = useState(initial)
  const [title, setTitle] = useState(editor.toEvent().title['zh-CN'] ?? '')
  const [date, setDate] = useState((editor.toEvent().schedule[0]?.value as { date?: string }).date ?? '')
  const [durationAmount, setDurationAmount] = useState('')
  const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours' | 'days' | 'weeks'>('days')
  const [yaml, setYaml] = useState(editor.yaml)
  const [message, setMessage] = useState<string>()

  const validateForm = () => {
    editor
      .setField('title', { 'zh-CN': title })
      .setField('schedule', [{
        id: 'initial',
        value: { kind: 'exact', date },
        recordedAt: new Date().toISOString(),
      }])
    const amount = Number(durationAmount)
    if (durationAmount.trim() && Number.isInteger(amount) && amount >= 1) {
      editor.setDuration({ amount, unit: durationUnit })
    } else {
      editor.setDuration(undefined)
    }
    setYaml(editor.yaml)
    showResult(editor.validate())
  }
  const validateYaml = () => {
    editor.setYaml(yaml)
    showResult(editor.validate())
  }
  const showResult = (result: ReturnType<typeof editor.validate>) => {
    setMessage(result.ok
      ? '校验通过，可以提交。'
      : result.message ?? result.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('；') ?? '校验失败')
  }

  return (
    <>
      <h1 className="text-3xl font-bold">Studio</h1>
      <p className="mt-2 text-slate-600">表单与 YAML 使用同一个 schema 校验器。持续时间与开始日期正交，可与重复规则并存。</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">表单模式</h2>
          <label className="mb-4 block text-sm">标题<Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="mb-4 block text-sm">准确日期（开始）<Input className="mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="block text-sm">持续数量
              <Input
                className="mt-1"
                inputMode="numeric"
                placeholder="可选"
                value={durationAmount}
                onChange={(event) => setDurationAmount(event.target.value)}
              />
            </label>
            <label className="block text-sm">单位
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={durationUnit}
                onChange={(event) => setDurationUnit(event.target.value as typeof durationUnit)}
                aria-label="持续单位"
              >
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
                <option value="weeks">周</option>
              </select>
            </label>
          </div>
          <Button onClick={validateForm}>校验表单</Button>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">YAML 模式</h2>
          <TextArea aria-label="事件 YAML" className="min-h-72 font-mono text-sm" value={yaml} onChange={(event) => setYaml(event.target.value)} />
          <Button className="mt-4" onClick={validateYaml}>校验 YAML</Button>
        </Card>
      </div>
      {message && <Alert className="mt-4" tone={message.startsWith('校验通过') ? 'success' : 'error'}>{message}</Alert>}
    </>
  )
}
