import { useState } from 'react'
import { Link } from 'react-router'
import { useAuthSession } from '../../stores'
import { useFeedStore } from '../../stores/feed'
import { authenticatedAdapter, patProvider, oauthProvider } from '../../lib/auth'
import { syncProfile, mergeProfile } from '../../lib/sync'
import { createIdbStore } from '../../lib/idb'
import type { UserData } from '@ahead/schema'
import { sourceKey } from '@ahead/protocol'
const syncStorage = createIdbStore('ahead-sync', 'profiles')
export function ProfileView() {
  const { session, setSession } = useAuthSession()
  const { profile, act, replaceProfile, refresh } = useFeedStore()
  const [locator, setLocator] = useState('')
  const [path, setPath] = useState('ahead.yaml')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const synchronize = async () => {
    if (!session) return
    setBusy(true); setMessage('')
    try {
      const key = session.identity.id + ':' + sourceKey({ locator, manifestPath: path })
      const base = await syncStorage.get<UserData>(key)
      const snapshot = useFeedStore.getState().profile
      const merged = await syncProfile({ adapter: authenticatedAdapter(), locator, path, local: snapshot, base })
      // Do not erase interactions made while a network request was in flight.
      const current = useFeedStore.getState().profile
      replaceProfile(current === snapshot ? merged : mergeProfile(merged, current, snapshot))
      await syncStorage.set(key, merged)
      await refresh()
      setMessage(current === snapshot ? '已合并本地与远端数据，并保存到 GitHub。' : '本次快照已保存到 GitHub；同步期间的新操作已保留，请再次同步。')
    } catch (error) { setMessage(String(error) + ' 本地数据仍保留；如有版本冲突，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="profile-view"><p className="eyebrow">A LITTLE MORE YOU</p><h1>{session ? '@' + session.identity.login : '我的个人资料'}</h1>
    <p>订阅与喜爱默认保存在本设备，无需登录。</p>
    <label className="privacy-setting"><input type="checkbox" checked={Boolean(profile.settings?.privacyRemoteImages)} onChange={(e) => act({ type: 'privacy', enabled: e.target.checked })} />不加载事件中的外部图片 URL</label>
    {session ? <><h2>同步到已有 UserData 文件</h2><p>首次同步合并两端的订阅与喜爱；之后保留本地删除操作。不会自动创建仓库。</p>
      <label>仓库 Locator<input value={locator} onChange={(e) => setLocator(e.target.value)} placeholder="github:owner/my-ahead" /></label>
      <label>Manifest 路径<input value={path} onChange={(e) => setPath(e.target.value)} /></label>
      <button disabled={busy || !locator} onClick={() => void synchronize()}>{busy ? '同步中…' : '合并并同步到 GitHub'}</button>
      <button className="quiet-button" onClick={() => {
        void (session.providerId === oauthProvider.id ? oauthProvider : patProvider).logout().then(() => setSession(null)).catch((e) => setMessage(String(e)))
      }}>退出登录</button>
    </> : <Link className="primary-link" to="/login">登录 GitHub 以同步 →</Link>}
    {message && <p role="status">{message}</p>}
    <h2>兴趣偏好</h2><p>喜爱与隐藏会逐步调整推荐；权重限制在 -1 到 1。</p>
    {Object.entries(profile.interests ?? {}).map(([tag, value]) => <p key={tag}>#{tag} <meter min={-1} max={1} value={value} /> {value.toFixed(2)}</p>)}
  </section>
}
