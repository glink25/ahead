import { ChevronRight, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
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
  const { profile, act, refresh, loading } = useFeedStore()
  const { db } = useData(),
    location = useLocation()
  const space = db?.spaces[db.active]
  const [message, setMessage] = useState('')
  if (location.hash === '#diagnostics')
    return <Navigate to="/settings/experimental#diagnostics" replace />
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
          <span>
            切换 <ChevronRight />
          </span>
        </Link>
        <Link className="setting-row" to="/following">
          频道与关注
          <ChevronRight />
        </Link>
      </div>
      <h2>账户</h2>
      <div className="settings-group">
        <div className="setting-row">
          <strong>{session ? '@' + session.identity.login : '尚未登录'}</strong>
          {!session && (
            <Link to="/login">
              登录 <ChevronRight />
            </Link>
          )}
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
              立即同步
              <RefreshCw />
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
            <ChevronRight />
          </Link>
        )}
        {space?.remote && (
          <details className="settings-disclosure">
            <summary>
              同步位置
              <ChevronRight />
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
        <button
          className="setting-row"
          disabled={loading}
          onClick={() => void refresh()}
        >
          更新频道内容<span>{loading ? '更新中…' : <RefreshCw />}</span>
        </button>
      </div>
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      <div className="settings-group">
        <Link className="setting-row" to="/settings/experimental">
          实验性设置
          <ChevronRight />
        </Link>
      </div>
    </section>
  )
}
