import { useState } from 'react'
import { useLocation } from 'react-router'
import { ChevronRight, Trash2 } from 'lucide-react'
import { useData } from '../../data/local'
import { useFeedStore } from '../../stores/feed'

export function ExperimentalView() {
  const errors = useFeedStore((s) => s.errors)
  const space = useData((s) => s.db?.spaces[s.db.active])
  const location = useLocation()
  const [clearing, setClearing] = useState(false)
  return (
    <section className="profile-view">
      <h1>实验性设置</h1>
      <div className="settings-group">
        <details
          id="diagnostics"
          className="settings-disclosure"
          open={location.hash === '#diagnostics' || undefined}
        >
          <summary>
            诊断信息
            <ChevronRight />
          </summary>
          <div className="settings-body diagnostic-output">
            {errors.map((error, i) => (
              <p key={i}>{error}</p>
            ))}
            {space?.error && <p>{space.error}</p>}
            {!errors.length && !space?.error && <p>暂无异常</p>}
          </div>
        </details>
      </div>
      <h2>本机数据</h2>
      <p className="muted">
        清除本站在此浏览器中的所有资料、登录状态和缓存。未同步的修改将永久丢失，云端仓库不受影响。
      </p>
      <div className="settings-group">
        <button
          className="setting-row danger"
          disabled={clearing}
          onClick={() => {
            if (
              !window.confirm(
                '确定清空本站的全部本机数据吗？\n\n所有本地资料、未同步修改、登录凭据和缓存将被永久删除，并退出登录。其他打开的本站标签页也会重置。\n\n此操作不可撤销，不会删除云端仓库。',
              )
            )
              return
            setClearing(true)
            window.location.replace('/reset.html')
          }}
        >
          {clearing ? '正在清空…' : '清空数据'}
          <Trash2 />
        </button>
      </div>
    </section>
  )
}
