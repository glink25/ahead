import { useState } from 'react'
import { useData, restoreVersion } from '../../data/local'
import { pickText } from '../../lib/format'
import type { Event } from '@ahead/schema'
export function HistoryView() {
  const { db } = useData(),
    [message, setMessage] = useState('')
  const space = db?.spaces[db.active]
  const records = Object.values(space?.records ?? {})
    .filter((r) => r.history.length)
    .sort((a, b) => b.revision.time - a.revision.time)
  return (
    <section>
      <h1>历史与恢复</h1>
      <p className="muted">{space?.name}</p>
      {!records.length && <p className="feedback">暂无历史版本</p>}
      {records.map((record) => (
        <details
          className="settings-group settings-disclosure"
          key={record.collection + record.key}
        >
          <summary>
            {record.collection === 'events'
              ? pickText((record.value as Event | undefined)?.title) ||
                pickText(
                  (
                    record.history.find((h) => !h.deleted)?.value as
                      Event | undefined
                  )?.title,
                ) ||
                '个人事件'
              : record.collection === 'profile'
                ? '个人资料'
                : ({
                    favorites: '收藏',
                    hidden: '隐藏',
                    pins: '置顶',
                    subscriptions: '订阅',
                    interests: '兴趣',
                    notes: '备注',
                    settings: '设置',
                    extensions: '资料关联',
                    patches: '个人修改',
                    feed: '事件流',
                  }[record.collection] ?? '个人数据')}
            {record.deleted ? ' · 已删除' : ''}
          </summary>
          <div className="settings-body">
            {record.history.map((version) => (
              <div className="setting-row" key={version.operation}>
                <span>
                  {new Date(version.revision.time).toLocaleString()} ·{' '}
                  {version.deleted ? '删除' : '修改'}
                </span>
                <button
                  onClick={() => {
                    if (space)
                      void restoreVersion(
                        space.id,
                        record.collection,
                        record.key,
                        version.operation,
                      )
                        .then(() => setMessage('已恢复到此资料'))
                        .catch(() => setMessage('恢复失败，请重试'))
                  }}
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
        </details>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
