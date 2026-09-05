import { profileName } from '../lib/profile-name'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useData } from '../data/local'
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  List,
  Settings,
  X,
} from 'lucide-react'
import { useAppBack, useNavigationJournal } from './navigation'
import { UndoToast } from './UndoToast'
import { useFeedStore } from '../stores/feed'
import { useSwipe } from '../hooks/useSwipe'

export function TabShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()

  const location = useLocation(),
    navigate = useNavigate()
  const mine = location.pathname === '/mine'
  const tab = mine || location.pathname === '/discover'
  const calendar =
    mine && new URLSearchParams(location.search).get('view') === 'calendar'
  useNavigationJournal()
  const back = useAppBack()
  const active = useData((s) => s.db?.spaces[s.db.active])
  const [mineUrl, setMineUrl] = useState('/mine')
  const { loading, errors, retry, loginSuggested } = useFeedStore()
  const [dismissedErrors, setDismissedErrors] = useState<string[]>([])
  const storageError = errors.some((error) => /messages\.(?:cannot_open_local_profiles|could_not_save|could_not_restore_local_data)/.test(error))
  useEffect(() => {
    if (
      loading ||
      storageError ||
      !errors.length ||
      errors.some((error) => /HTTP (403|429)|messages\.github_(?:access|request)/.test(error))
    )
      return
    const timer = setTimeout(() => setDismissedErrors(errors), 6000)
    return () => clearTimeout(timer)
  }, [errors, loading, storageError])
  const { offset, dragging, handlers } = useSwipe(
    (direction) =>
      navigate(direction === 'left' ? '/discover' : mineUrl),
    { left: tab && mine, right: tab && !mine },
  )
  useEffect(() => {
    if (mine) setMineUrl(location.pathname + location.search)
  }, [location.pathname, location.search, tab, mine])
  const switchMineView = () => {
    const params = new URLSearchParams(location.search)
    params.set('view', calendar ? 'timeline' : 'calendar')
    navigate('/mine?' + params, { replace: true })
  }
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,button,a,summary',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return
      if (e.key === 'Escape' && !tab) back()
      if (tab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        if (e.key === 'ArrowLeft' ? !mine : mine)
          navigate(e.key === 'ArrowLeft' ? mineUrl : '/discover')
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [tab, navigate, back, mineUrl, location.pathname])
  return (
    <div
      className={
        'app-shell' + (location.pathname === '/discover' ? ' immersive' : '')
      }
    >
      <header className="app-header">
        <div className="header-left">
          {!tab ? (
            <button
              className="back-button"
              onClick={back}
              aria-label={t('messages.go_back')}
            >
              <ArrowLeft />  {t('messages.back')} </button>
          ) : mine ? (
            <Link
              className="profile-switch"
              to="/profiles"
              aria-label={t('messages.switch_profile')}
            >
              <span>{profileName(active)}</span>
              <ChevronDown />
            </Link>
          ) : null}
        </div>
        {tab ? (
          <nav className="segmented" aria-label={t('messages.main_navigation')}>
            <Link
              to={mineUrl}
              replace={mine}
              aria-current={mine ? 'page' : undefined}
            >
               {t('messages.mine')} </Link>
            <Link
              to="/discover"
              replace={!mine}
              aria-current={!mine ? 'page' : undefined}
            >
               {t('messages.discover')} </Link>
          </nav>
        ) : (
          <span />
        )}
        <div className="header-right">
          {mine && (
            <button
              className="mine-view-toggle"
              aria-label={
                calendar
                  ? t('messages.switch_to_timeline')
                  : t('messages.switch_to_calendar')
              }
              onClick={switchMineView}
            >
              {calendar ? <List /> : <CalendarDays />}
            </button>
          )}
          <Link
            className="avatar-button"
            to="/settings"
            replace={location.pathname === '/settings'}
            aria-label={t('messages.settings')}
          >
            <Settings />
          </Link>
        </div>
      </header>
      {loading && location.pathname !== '/discover' && (
        <div className="loading-progress" role="status" aria-label={t('messages.updating')} />
      )}
      {!!errors.length &&
        (tab || storageError) &&
        dismissedErrors !== errors && (
          <div className="error-strip" role="status">
            <span>
              {storageError
                ? t('messages.some_changes_could_not_be_saved_to_this_device')
                : loginSuggested
                  ? t('messages.github_access_is_limited_sign_in_for_a_higher_request_limit')
                  : t('messages.some_content_could_not_be_updated')}
            </span>
            {!storageError && (
              <button disabled={loading} onClick={() => void retry()}>
                 {t('messages.retry')} </button>
            )}
            {loginSuggested && <Link to="/login">{t('messages.sign_in_to_github')}</Link>}
            <Link to="/settings/experimental#diagnostics">{t('messages.details')}</Link>
            <button
              aria-label={t('messages.dismiss_notification')}
              onClick={() => setDismissedErrors(errors)}
            >
              <X />
            </button>
          </div>
        )}
      <main
        className={tab ? 'tab-stage' : 'overlay-stage'}
        {...(tab ? handlers : {})}
        data-swiping={tab && dragging ? 'true' : undefined}
        style={
          tab
            ? ({ '--tab-swipe-offset': offset + 'px' } as CSSProperties)
            : undefined
        }
      >
        {children}
      </main>
      <UndoToast />
    </div>
  )
}
