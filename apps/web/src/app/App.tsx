import { activateSession, restoreCachedIdentity } from '../data/session'
import { useData } from '../data/local'
import { lazy, Suspense, useEffect } from 'react'
import { PageLoadBoundary, PageSkeleton, type SkeletonVariant } from './PageSkeleton'
import { hasNamespace } from '../i18n'
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
const ExperimentalView = lazy(() =>
  import('../features/profile/ExperimentalView').then((m) => ({
    default: m.ExperimentalView,
  })),
)
const ProfilesView = lazy(() =>
  import('../features/profiles/ProfilesView').then((m) => ({
    default: m.ProfilesView,
  })),
)
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
const ChannelDetail = lazy(() =>
  import('../features/share/ChannelDetail').then((module) => ({ default: module.ChannelDetail })),
)
const PersonDetail = lazy(() =>
  import('../features/share/PersonDetail').then((module) => ({ default: module.PersonDetail })),
)
const SearchView = lazy(() =>
  import('../features/search/SearchView').then((module) => ({ default: module.SearchView })),
)

function skeletonFor(path: string): SkeletonVariant {
  if (path === '/discover') return 'poster'
  if (path === '/settings' || path.includes('/profiles')) return 'settings'
  if (path === '/studio') return 'editor'
  if (path.startsWith('/events/')) return 'detail'
  return 'list'
}
function Landing() {

  const { session, loading } = useAuthSession()
  const active = useData((s) => s.db?.active)
  return loading ? (
    <PageSkeleton variant="list" />
  ) : (
    <Navigate
      to={
        session
          ? active === 'guest'
            ? '/profiles?choose=1'
            : '/mine'
          : '/discover'
      }
      replace
    />
  )
}
export function App() {
  const location = useLocation()
  const browsing =
    location.pathname === '/mine' || location.pathname === '/discover'
  const mine = location.pathname === '/mine'
  const {
    setSession,
    setLoading,
    setRestoreError
  } = useAuthSession()
  useEffect(() => {
    const explicit =
      location.search.includes('github_authorized=') ||
      sessionStorage.getItem('ahead-login-choice') === '1'
    sessionStorage.removeItem('ahead-login-choice')
    void (async () => {
      const result = navigator.onLine
        ? await bootstrapAuthSession({ patProvider, oauthProvider })
        : { session: await restoreCachedIdentity(), error: null }
      const restored =
        result.session ?? (result.error ? await restoreCachedIdentity() : null)
      await activateSession(restored, explicit)
      setSession(restored)
      setRestoreError(result.error)
    })()
      .catch((error) => setRestoreError(String(error)))
      .finally(() => setLoading(false))
    void useFeedStore
      .getState()
      .initialize()
      .catch(() =>
        useFeedStore.setState({
          errors: ['messages.cannot_open_local_profiles_check_browser_storage_permissions'],
          loading: false,
        }),
      )
  }, [setSession, setLoading, setRestoreError])
  return (
    <TabShell>
      <div
        className={'browser-pages' + (!browsing ? ' browsing-hidden' : '')}
        style={{
          transform: mine
            ? 'translateX(var(--tab-swipe-offset, 0px))'
            : 'translateX(calc(-50% + var(--tab-swipe-offset, 0px)))',
        }}
      >
        <div
          className="browser-pane"
          inert={!mine || !browsing}
          aria-hidden={!mine || !browsing}
        >
          {(browsing || hasNamespace('mine')) && (
            <PageLoadBoundary><Suspense fallback={<PageSkeleton variant="list" />}><MineTab /></Suspense></PageLoadBoundary>
          )}
        </div>
        <div
          className="browser-pane"
          inert={mine || !browsing}
          aria-hidden={mine || !browsing}
        >
          {(browsing || hasNamespace('discover')) && (
            <PageLoadBoundary><Suspense fallback={<PageSkeleton variant="poster" />}><DiscoverTab active={browsing && !mine} /></Suspense></PageLoadBoundary>
          )}
        </div>
      </div>
      <PageLoadBoundary>
        <Suspense fallback={<PageSkeleton variant={skeletonFor(location.pathname)} />}>
          <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/mine" element={null} />
          <Route path="/discover" element={null} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/channels/view" element={<ChannelDetail />} />
          <Route path="/people/view" element={<PersonDetail />} />
          <Route path="/following" element={<FollowingView />} />
          <Route path="/search" element={<SearchView />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/profiles" element={<ProfilesView />} />
          <Route
            path="/history"
            element={<Navigate to="/settings" replace />}
          />
          <Route path="/settings/experimental" element={<ExperimentalView />} />
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
      </PageLoadBoundary>
    </TabShell>
  )
}
