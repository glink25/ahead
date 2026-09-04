import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuthSession } from '../../stores'
import {
  useData,
  createLocalProfile,
  database,
  changed,
} from '../../data/local'
import { connectProfile, discoverProfiles } from '../../data/profiles'
import { chooseProfile } from '../../data/session'
import { syncNow } from '../../data/scheduler'
export function ProfilesView() {
  const { session } = useAuthSession(),
    { db } = useData()
  const navigate = useNavigate()
  const [name, setName] = useState(''),
    [privateRepo, setPrivate] = useState(true)
  const [bio, setBio] = useState('')
  const [address, setAddress] = useState(''),
    [path, setPath] = useState('ahead.yaml')
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const account = session ? String(session.identity.id) : undefined
  const profiles = Object.values(db?.spaces ?? {}).filter(
    (s) => s.id !== 'guest' && (s.account === account || !s.account),
  )
  useEffect(() => {
    if (!session || !navigator.onLine) return
    const controller = new AbortController()
    void discoverProfiles(session, setMessage, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setMessage('')
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage('暂时无法查找更多资料，可使用已缓存资料或通过地址添加')
      })
    return () => controller.abort()
  }, [session?.identity.id])
  const select = async (id: string) => {
    setBusy(true)
    try {
      await chooseProfile(id, session)
      navigate('/mine')
    } catch {
      setMessage('未能切换个人资料，本机数据已保留')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="profiles-view">
      <h1>个人资料</h1>
      <p className="muted">
        {session ? '@' + session.identity.login : '本机资料'}
      </p>
      <div className="profile-list">
        {profiles.map((space) => (
          <article className="settings-group" key={space.id}>
            <button
              className="setting-row"
              disabled={busy}
              onClick={() => void select(space.id)}
            >
              <span>
                <strong>{space.name}</strong>
                <small className="profile-meta">
                  {space.private ? '私有' : '公开'}
                  {space.remote
                    ? ' · ' + space.remote.owner + '/' + space.remote.repo
                    : ' · 本机'}
                </small>
              </span>
              <span>{space.id === db?.active ? '当前' : '→'}</span>
            </button>
            {(space.provision || space.feedProvision) &&
              space.status === 'attention' && (
                <details className="settings-disclosure">
                  <summary>调整待创建的仓库名称</summary>
                  <form
                    className="settings-body"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const form = new FormData(e.currentTarget)
                      void database
                        .transaction((value) => {
                          const s = value.spaces[space.id]!
                          const key = s.remote ? 'feedProvision' : 'provision'
                          if (s[key])
                            s[key]!.repo = String(form.get('repo')).trim()
                        })
                        .then(() => {
                          changed()
                          void syncNow(space.id)
                        })
                    }}
                  >
                    <input
                      name="repo"
                      required
                      pattern="[A-Za-z0-9_.-]+"
                      defaultValue={
                        (space.remote ? space.feedProvision : space.provision)
                          ?.repo
                      }
                    />
                    <button className="primary-link">重试创建</button>
                  </form>
                </details>
              )}
          </article>
        ))}
      </div>
      <details
        className="settings-group settings-disclosure"
        open={!profiles.length}
      >
        <summary>
          新建个人资料<span>＋</span>
        </summary>
        <form
          className="settings-body"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            void createLocalProfile(name.trim(), privateRepo, account, bio)
              .then((id) => chooseProfile(id, session))
              .then(() => navigate('/mine'))
              .catch(() => setMessage('未能创建资料，请检查本机存储后重试'))
              .finally(() => setBusy(false))
          }}
        >
          <label>
            名称
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的盼头、工作、游戏"
            />
          </label>
          <label>
            简介（可选）
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          <label className="setting-row">
            可见性
            <select
              value={privateRepo ? 'private' : 'public'}
              onChange={(e) => setPrivate(e.target.value === 'private')}
            >
              <option value="private">私有</option>
              <option value="public">公开</option>
            </select>
          </label>
          <button className="primary-link" disabled={busy || !name.trim()}>
            创建并使用
          </button>
        </form>
      </details>
      {session && (
        <details className="settings-group settings-disclosure">
          <summary>
            通过仓库地址添加<span>＋</span>
          </summary>
          <form
            className="settings-body"
            onSubmit={(e) => {
              e.preventDefault()
              setBusy(true)
              void connectProfile(session, address.trim(), path.trim())
                .then((id) => select(id))
                .catch(() =>
                  setMessage('无法添加资料，请检查地址、文件格式和仓库授权'),
                )
                .finally(() => setBusy(false))
            }}
          >
            <label>
              仓库地址
              <input
                required
                placeholder="github:owner/ahead-user-main"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label>
              资料文件路径
              <input
                required
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            <button className="primary-link" disabled={busy}>
              添加并使用
            </button>
          </form>
        </details>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void select('guest')}
      >
        继续使用本机资料
      </button>
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
