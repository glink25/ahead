import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { bootstrapAuthSession } from '../auth-bootstrap'
import { useAuthSession } from '../stores'
import { useFeedStore } from '../stores/feed'
import { patProvider, oauthProvider } from '../lib/auth'
import { TabShell } from './TabShell'
import { DiscoverTab } from '../features/discover/DiscoverTab'
import { MineTab } from '../features/mine/MineTab'
import { EventDetail } from '../features/event/EventDetail'
import { FollowingView } from '../features/following/FollowingView'
const StudioPage = lazy(() => import('../features/studio/StudioView').then((module) => ({ default: module.StudioPage })))
const ProfileView = lazy(() => import('../features/profile/ProfileView').then((module) => ({ default: module.ProfileView })))
const LoginPage = lazy(() => import('../features/profile/LoginView').then((module) => ({ default: module.LoginPage })))
function Landing() {
  const { session, loading } = useAuthSession()
  return loading ? <div className="empty-view">正在恢复登录态…</div> : <Navigate to={session ? '/mine' : '/discover'} replace />
}
export function App() {
  const { setSession, setLoading, setRestoreError } = useAuthSession()
  useEffect(() => {
    void bootstrapAuthSession({ patProvider, oauthProvider }).then(({ session, error }) => {
      setSession(session); setRestoreError(error)
    }).catch((error) => setRestoreError(String(error))).finally(() => setLoading(false))
    void useFeedStore.getState().initialize()
  }, [setSession, setLoading, setRestoreError])
  return <TabShell><Suspense fallback={<div className="empty-view">正在打开页面…</div>}><Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/mine" element={<MineTab />} />
    <Route path="/discover" element={<DiscoverTab />} />
    <Route path="/events/:id" element={<EventDetail />} />
    <Route path="/following" element={<FollowingView />} />
    <Route path="/studio" element={<StudioPage />} />
    <Route path="/profile" element={<ProfileView />} />
    <Route path="/me" element={<Navigate to="/profile" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></TabShell>
}
