import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuthSession } from '../../stores'
import { useFeedStore } from '../../stores/feed'
import { patProvider, oauthProvider } from '../../lib/auth'
import { useData } from '../../data/local'
import { forgetSession } from '../../data/session'
import { setPaused, syncNow } from '../../data/scheduler'
const labels = {
  local: '仅在本机',
  pending: '等待同步',
  offline: '等待联网',
  syncing: '同步中',
  synced: '已同步',
  auth: '需要重新登录',
  attention: '需要处理',
  paused: '已暂停',
}
export function ProfileView() {
  const { session, setSession } = useAuthSession()
  const { profile, act, refresh, loading, errors } = useFeedStore()
  const { db } = useData(),
    location = useLocation()
  const space = db?.spaces[db.active]
  const [message, setMessage] = useState('')
  return (
    <section className="profile-view">
      <h1>设置</h1>
      <h2>个人资料</h2>
      <div className="settings-group">
        <Link className="setting-row" to="/profiles">
          <span>
            <strong>{space?.name ?? '本机资料'}</strong>
            <small className="profile-meta">
              {space?.private === false ? '公开' : '私有'}
            </small>
          </span>
          <span>切换 →</span>
        </Link>
        <Link className="setting-row" to="/following">
          频道与关注<span>→</span>
        </Link>
      </div>
      <h2>账户</h2>
      <div className="settings-group">
        <div className="setting-row">
          <strong>{session ? '@' + session.identity.login : '尚未登录'}</strong>
          {!session && <Link to="/login">登录 →</Link>}
        </div>
        {session && (
          <button
            className="setting-row danger"
            onClick={() => {
              void forgetSession()
                .then(() =>
                  (session.providerId === oauthProvider.id
                    ? oauthProvider
                    : patProvider
                  ).logout(),
                )
                .then(() => setSession(null))
                .catch(() => setMessage('退出未完成，请重试'))
            }}
          >
            退出登录
          </button>
        )}
      </div>
      <h2>显示与隐私</h2>
      <div className="settings-group">
        <label className="setting-row">
          加载外部图片
          <input
            role="switch"
            type="checkbox"
            checked={!profile.settings?.privacyRemoteImages}
            onChange={(e) =>
              act({ type: 'privacy', enabled: !e.target.checked })
            }
          />
        </label>
      </div>
      <h2>数据与同步</h2>
      <div className="settings-group">
        <div className="setting-row">
          <span>{space ? labels[space.status] : '正在打开资料'}</span>
          {space?.lastSynced && (
            <small>{new Date(space.lastSynced).toLocaleTimeString()}</small>
          )}
        </div>
        {space?.account && (
          <>
            <button
              className="setting-row"
              onClick={() =>
                void syncNow(space.id).catch(() =>
                  setMessage('无法同步，请重试'),
                )
              }
              disabled={space.status === 'syncing' || !session}
            >
              立即同步<span>↻</span>
            </button>
            <button
              className="setting-row"
              onClick={() =>
                void setPaused(space.id, !space.paused).catch(() =>
                  setMessage('未能保存设置'),
                )
              }
            >
              {space.paused ? '恢复自动同步' : '暂停自动同步'}
            </button>
          </>
        )}
        {(space?.status === 'auth' || space?.status === 'attention') && (
          <Link
            className="setting-row"
            to={space.status === 'auth' ? '/login' : '/profiles'}
          >
            {space.status === 'auth' ? '重新登录' : '检查资料与仓库授权'}
            <span>→</span>
          </Link>
        )}
        {space?.remote && (
          <details className="settings-disclosure">
            <summary>
              同步位置<span>›</span>
            </summary>
            <div className="settings-body">
              <p>
                {space.remote.owner}/{space.remote.repo}
              </p>
              {space.feed && (
                <p>
                  个人事件：{space.feed.owner}/{space.feed.repo}
                </p>
              )}
            </div>
          </details>
        )}
        <Link className="setting-row" to="/history">
          历史与恢复<span>→</span>
        </Link>
        <button
          className="setting-row"
          disabled={loading}
          onClick={() => void refresh()}
        >
          更新频道内容<span>{loading ? '更新中…' : '↻'}</span>
        </button>
      </div>
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      <h2>高级</h2>
      <div className="settings-group">
        <details
          id="diagnostics"
          className="settings-disclosure"
          open={location.hash === '#diagnostics' || undefined}
        >
          <summary>
            诊断信息<span>›</span>
          </summary>
          <div className="settings-body diagnostic-output">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
            {space?.error && <p>{space.error}</p>}
            {!errors.length && !space?.error && <p>暂无异常</p>}
          </div>
        </details>
      </div>
    </section>
  )
}
