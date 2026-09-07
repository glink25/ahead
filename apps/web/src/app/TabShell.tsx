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
  Search as SearchIcon,
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
  const eventDetail = location.pathname.startsWith('/events/')
  const immersive = location.pathname === '/discover' || eventDetail
  const calendar =
    mine && new URLSearchParams(location.search).get('view') === 'calendar'
  useNavigationJournal()
  const back = useAppBack()
  const active = useData((s) => s.db?.spaces[s.db.active])
  const [mineUrl, setMineUrl] = useState('/mine')
  const { refreshing, errors, retry, loginSuggested } = useFeedStore()
  const [dismissedErrors, setDismissedErrors] = useState<string[]>([])
  const storageError = errors.some((error) => /messages\.(?:cannot_open_local_profiles|could_not_save|could_not_restore_local_data)/.test(error))
  useEffect(() => {
    if (
      refreshing ||
      storageError ||
      !errors.length ||
      errors.some((error) => /HTTP (403|429)|messages\.github_(?:access|request)/.test(error))
    )
      return
    const timer = setTimeout(() => setDismissedErrors(errors), 6000)
    return () => clearTimeout(timer)
  }, [errors, refreshing, storageError])
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
      className="flex h-dvh min-h-full flex-col overflow-hidden bg-surface"
    >
      <header className={`z-20 grid h-[calc(var(--header-height)+env(safe-area-inset-top))] shrink-0 grid-cols-[1fr_auto_1fr] items-center px-8 pb-0 pt-[env(safe-area-inset-top)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[env(safe-area-inset-top)] max-[600px]:px-5 ${immersive ? 'absolute inset-x-0 top-0 bg-[linear-gradient(#08150d80,transparent)] text-white before:bg-[#07130d42]' : 'relative bg-surface before:bg-[#0f172a]'}`}>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden pr-3 [&>a]:py-3 [&>a]:text-sm">
          {!tab ? (
            <button
              className="inline-flex items-center gap-1.5 py-3 text-sm"
              onClick={back}
              aria-label={t('messages.go_back')}
            >
              <ArrowLeft />  {t('messages.back')} </button>
          ) : mine ? (
            <Link
              className="flex min-w-0 max-w-full items-center gap-1.5 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap"
              to="/profiles"
              aria-label={t('messages.switch_profile')}
            >
              <span>{profileName(active)}</span>
              <ChevronDown />
            </Link>
          ) : null}
        </div>
        {tab ? (
          <nav className={`flex items-center gap-[26px] max-[600px]:gap-6 [&>a]:relative [&>a]:py-3 [&>a]:text-base [&>a]:font-semibold [&>a]:text-muted [&>a[aria-current=page]]:text-ink [&>a[aria-current=page]]:after:absolute [&>a[aria-current=page]]:after:bottom-1 [&>a[aria-current=page]]:after:left-1/4 [&>a[aria-current=page]]:after:right-1/4 [&>a[aria-current=page]]:after:h-[3px] [&>a[aria-current=page]]:after:rounded [&>a[aria-current=page]]:after:bg-current [&>a[aria-current=page]]:after:content-[''] max-[600px]:[&>a]:text-[15px] ${immersive ? '[&>a]:text-[#ffffffa6] [&>a[aria-current=page]]:text-white' : ''}`} aria-label={t('messages.main_navigation')}>
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
        <div className="flex items-center justify-end gap-2">
          {location.pathname === '/discover' && (
            <Link
              className={`grid size-[38px] place-items-center rounded-full border text-[19px] max-[600px]:size-[34px] max-[600px]:text-[17px] ${immersive ? 'border-[#ffffff35] bg-[#0002] text-white backdrop-blur-xl' : 'border-line bg-panel'}`}
              to="/search"
              aria-label={t('messages.search_events')}
            >
              <SearchIcon />
            </Link>
          )}
          {mine && (
            <button
              className="grid size-[34px] flex-[0_0_34px] place-items-center rounded-full border border-line bg-panel p-0"
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
            className={`grid size-[38px] place-items-center rounded-full border text-[19px] max-[600px]:size-[34px] max-[600px]:text-[17px] ${immersive ? 'border-[#ffffff35] bg-[#0002] text-white backdrop-blur-xl' : 'border-line bg-panel'}`}
            to="/settings"
            replace={location.pathname === '/settings'}
            aria-label={t('messages.settings')}
          >
            <Settings />
          </Link>
        </div>
      </header>
      {refreshing && location.pathname !== '/discover' && (
        <div className="absolute inset-x-0 top-0 z-35 h-0.5 animate-[loading_1.5s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,#9db96d,transparent)] motion-reduce:animate-none" role="status" aria-label={t('messages.updating')} />
      )}
      {!!errors.length &&
        (tab || storageError) &&
        dismissedErrors !== errors && (
          <div className="absolute left-1/2 top-[calc(var(--header-height)+env(safe-area-inset-top)+4px)] z-22 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center gap-3.5 rounded-3xl border border-line bg-panel px-[15px] py-[9px] text-xs text-ink shadow-[0_4px_20px_#0001] [&_a]:text-muted [&_button]:text-muted" role="status">
            <span>
              {storageError
                ? t('messages.some_changes_could_not_be_saved_to_this_device')
                : loginSuggested
                  ? t('messages.github_access_is_limited_sign_in_for_a_higher_request_limit')
                  : t('messages.some_content_could_not_be_updated')}
            </span>
            {!storageError && (
              <button disabled={refreshing} onClick={() => void retry()}>
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
        className={tab
          ? "relative min-h-0 flex-1 touch-pan-y overflow-hidden [&[data-swiping=true]>div]:transition-none [&_*]:touch-pan-y"
          : `relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto [&_h1]:text-[32px] [&_h1]:font-[650] [&_h1]:tracking-[-1px] [&_h2]:mx-1 [&_h2]:mb-3 [&_h2]:mt-[30px] [&_h2]:text-base [&_h2]:font-semibold [&_p]:leading-[1.7] max-[600px]:[&_h1]:text-[28px] ${eventDetail ? 'px-0 pb-[calc(60px+env(safe-area-inset-bottom))] pt-0 [&>[data-event-detail]]:mx-0 [&>[data-event-detail]]:w-full [&>[data-event-detail]]:max-w-none [&>:not([data-event-detail])]:mt-[calc(var(--header-height)+env(safe-area-inset-top))]' : 'px-6 pb-[calc(60px+env(safe-area-inset-bottom))] pt-7 max-[600px]:px-5 max-[600px]:pb-[calc(40px+env(safe-area-inset-bottom))] max-[600px]:pt-5 [&>*:not([data-browser-pages])]:mx-auto [&>*:not([data-browser-pages])]:max-w-[760px]'}`}
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
