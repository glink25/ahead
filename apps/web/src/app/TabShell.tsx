import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useData } from '../data/local'
import { ArrowLeft, ChevronDown, Settings, X } from 'lucide-react'
import { useAppBack, useNavigationJournal } from './navigation'
import { UndoToast } from './UndoToast'
import { useFeedStore } from '../stores/feed'
import { useSwipe } from '../hooks/useSwipe'

export function TabShell({ children }: { children: ReactNode }) {
  const location = useLocation(),
    navigate = useNavigate()
  const mine = location.pathname === '/mine'
  const tab = mine || location.pathname === '/discover'
  useNavigationJournal()
  const back = useAppBack()
  const active = useData((s) => s.db?.spaces[s.db.active])
  const [mineUrl, setMineUrl] = useState('/mine')
  const { loading, errors, retry, loginSuggested, marketStatus, marketLoaded } =
    useFeedStore()
  const [dismissedErrors, setDismissedErrors] = useState<string[]>([])
  const storageError = errors.some((error) => /存储|保存|恢复本地/.test(error))
  useEffect(() => {
    if (
      loading ||
      storageError ||
      !errors.length ||
      errors.some((error) => /HTTP (403|429)|额度|访问受限/.test(error))
    )
      return
    const timer = setTimeout(() => setDismissedErrors(errors), 6000)
    return () => clearTimeout(timer)
  }, [errors, loading, storageError])
  const { offset, handlers } = useSwipe((direction) => {
    if (tab && (direction === 'left' ? mine : !mine))
      navigate(direction === 'left' ? '/discover' : mineUrl)
  })
  useEffect(() => {
    if (mine) setMineUrl(location.pathname + location.search)
  }, [location.pathname, location.search, tab, mine])
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
              aria-label="返回上一页"
            >
              <ArrowLeft /> 返回
            </button>
          ) : mine ? (
            <Link
              className="profile-switch"
              to="/profiles"
              aria-label="切换个人资料"
            >
              <span>{active?.name ?? '我的盼头'}</span>
              <ChevronDown />
            </Link>
          ) : null}
        </div>
        {tab ? (
          <nav className="segmented" aria-label="主导航">
            <Link
              to={mineUrl}
              replace={mine}
              aria-current={mine ? 'page' : undefined}
            >
              我的
            </Link>
            <Link
              to="/discover"
              replace={!mine}
              aria-current={!mine ? 'page' : undefined}
            >
              发现
            </Link>
          </nav>
        ) : (
          <span />
        )}
        <div className="header-right">
          <Link
            className="avatar-button"
            to="/settings"
            replace={location.pathname === '/settings'}
            aria-label="设置"
          >
            <Settings />
          </Link>
        </div>
      </header>
      {loading && (
        <div className="loading-progress" role="status" aria-label="正在更新" />
      )}
      {location.pathname === '/discover' && marketStatus !== 'idle' && (
        <div className="market-progress" role="status" aria-live="polite">
          {marketStatus === 'initial'
            ? '正在读取首批内容…'
            : marketStatus === 'appending'
              ? `正在追加内容 · 已读取 ${marketLoaded} 个源`
              : marketStatus === 'paused'
                ? '已暂停追加'
                : marketStatus === 'complete'
                  ? `市场已加载 · ${marketLoaded} 个源`
                  : '追加失败，可重试'}
        </div>
      )}
      {!!errors.length &&
        (tab || storageError) &&
        dismissedErrors !== errors && (
          <div className="error-strip" role="status">
            <span>
              {storageError
                ? '部分更改未能保存到此设备'
                : loginSuggested
                  ? 'GitHub 访问受限，登录可提高请求额度'
                  : '部分内容未能更新'}
            </span>
            {!storageError && (
              <button disabled={loading} onClick={() => void retry()}>
                重试
              </button>
            )}
            {loginSuggested && <Link to="/login">登录 GitHub</Link>}
            <Link to="/settings/experimental#diagnostics">详情</Link>
            <button
              aria-label="关闭提示"
              onClick={() => setDismissedErrors(errors)}
            >
              <X />
            </button>
          </div>
        )}
      <main
        className={tab ? 'tab-stage' : 'overlay-stage'}
        {...(tab ? handlers : {})}
        style={
          tab
            ? {
                transform: 'translateX(' + offset + 'px)',
                transition: offset ? 'none' : undefined,
              }
            : undefined
        }
      >
        {children}
      </main>
      <UndoToast />
    </div>
  )
}
