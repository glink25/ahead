import { activateSession, restoreCachedIdentity } from '../data/session'
import { useData } from '../data/local'
import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { bootstrapAuthSession } from '../auth-bootstrap'
import { useAuthSession } from '../stores'
import { useFeedStore } from '../stores/feed'
import { patProvider, oauthProvider } from '../lib/auth'
import { TabShell } from './TabShell'
import { DiscoverTab } from '../features/discover/DiscoverTab'
import { MineTab } from '../features/mine/MineTab'
import { EventDetail } from '../features/event/EventDetail'
import { FollowingView } from '../features/following/FollowingView'
const HistoryView = lazy(() => import('../features/profiles/HistoryView').then((m) => ({ default: m.HistoryView })))
const ProfilesView = lazy(() => import('../features/profiles/ProfilesView').then((m) => ({ default: m.ProfilesView })))
const StudioPage = lazy(() =>
  import('../features/studio/StudioView').then((module) => ({
    default: module.StudioPage,
  })),
)
const ProfileView = lazy(() =>
  import('../features/profile/ProfileView').then((module) => ({
    default: module.ProfileView,
  })),
)
const LoginPage = lazy(() =>
  import('../features/profile/LoginView').then((module) => ({
    default: module.LoginPage,
  })),
)
function Landing() {
  const { session, loading } = useAuthSession()
  const active = useData((s) => s.db?.active)
  return loading ? (
    <div className="empty-view">正在加载…</div>
  ) : (
    <Navigate to={session ? active === 'guest' ? '/profiles?choose=1' : '/mine' : '/discover'} replace />
  )
}
export function App() {
  const location = useLocation()
  const browsing =
    location.pathname === '/mine' || location.pathname === '/discover'
  const mine = location.pathname === '/mine'
  const { setSession, setLoading, setRestoreError, loading: restoringIdentity } = useAuthSession()
  useEffect(() => {
    const explicit = location.search.includes('github_authorized=') || sessionStorage.getItem('ahead-login-choice') === '1'
    sessionStorage.removeItem('ahead-login-choice')
    void (async () => {
      const result = navigator.onLine ? await bootstrapAuthSession({ patProvider, oauthProvider }) : { session: await restoreCachedIdentity(), error: null }
      const restored = result.session ?? (result.error ? await restoreCachedIdentity() : null)
      await activateSession(restored, explicit)
      setSession(restored); setRestoreError(result.error)
    })().catch((error) => setRestoreError(String(error))).finally(() => setLoading(false))
    void useFeedStore.getState().initialize().catch(() => useFeedStore.setState({ errors: ['无法打开本机资料，请检查浏览器存储权限'], loading: false }))
  }, [setSession, setLoading, setRestoreError])
  if (restoringIdentity) return <div className="empty-view" role="status">正在恢复账户…</div>
  return (
    <TabShell>
      <div
        className={'browser-pages' + (!browsing ? ' browsing-hidden' : '')}
        style={{ transform: mine ? 'translateX(0)' : 'translateX(-50%)' }}
      >
        <div
          className="browser-pane"
          inert={!mine || !browsing}
          aria-hidden={!mine || !browsing}
        >
          <MineTab />
        </div>
        <div
          className="browser-pane"
          inert={mine || !browsing}
          aria-hidden={mine || !browsing}
        >
          <DiscoverTab active={browsing && !mine} />
        </div>
      </div>
      <Suspense fallback={<div className="empty-view">正在打开页面…</div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/mine" element={null} />
          <Route path="/discover" element={null} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/following" element={<FollowingView />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/profiles" element={<ProfilesView />} />
          <Route path="/history" element={<HistoryView />} />
          <Route path="/settings" element={<ProfileView />} />
          <Route
            path="/profile"
            element={<Navigate to="/settings" replace />}
          />
          <Route path="/me" element={<Navigate to="/settings" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </TabShell>
  )
}
