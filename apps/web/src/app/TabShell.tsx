import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuthSession } from '../stores'
import { useFeedStore } from '../stores/feed'
import { useSwipe } from '../hooks/useSwipe'

export function TabShell({ children }: { children: ReactNode }) {
  const location = useLocation(),
    navigate = useNavigate()
  const mine = location.pathname === '/mine'
  const tab = mine || location.pathname === '/discover'
  const [previousTab, setPreviousTab] = useState('/discover')
  const [mineUrl, setMineUrl] = useState('/mine')
  const { session } = useAuthSession()
  const { loading, errors, undoProfile, undo, refresh } = useFeedStore()
  const [showUndo, setShowUndo] = useState(false)
  const [dismissedErrors, setDismissedErrors] = useState<string[]>([])
  const storageError = errors.some((error) => /存储|保存|恢复本地/.test(error))
  useEffect(() => {
    if (loading || storageError || !errors.length) return
    const timer = setTimeout(() => setDismissedErrors(errors), 6000)
    return () => clearTimeout(timer)
  }, [errors, loading, storageError])
  const { offset, handlers } = useSwipe((direction) => {
    if (tab) navigate(direction === 'left' ? '/discover' : mineUrl)
  })
  useEffect(() => {
    if (tab) setPreviousTab(location.pathname + location.search)
    if (mine) setMineUrl(location.pathname + location.search)
  }, [location.pathname, location.search, tab, mine])
  useEffect(() => {
    setShowUndo(Boolean(undoProfile))
    const timer = setTimeout(() => setShowUndo(false), 4500)
    return () => clearTimeout(timer)
  }, [undoProfile])
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
      if (e.key === 'Escape' && !tab && location.pathname !== '/studio')
        navigate(previousTab)
      if (tab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        navigate(e.key === 'ArrowLeft' ? mineUrl : '/discover')
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [tab, navigate, previousTab, mineUrl, location.pathname])
  return (
    <div
      className={
        'app-shell' + (location.pathname === '/discover' ? ' immersive' : '')
      }
    >
      <header className="app-header">
        <div className="header-left">
          {!tab ? (
            <Link to={previousTab} aria-label="关闭页面">
              ← 返回
            </Link>
          ) : (
            <Link className="wordmark" to="/discover" aria-label="Ahead 首页">
              ahead<span>✳</span>
            </Link>
          )}
        </div>
        {tab ? (
          <nav className="segmented" aria-label="主导航">
            <Link to={mineUrl} aria-current={mine ? 'page' : undefined}>
              我的
            </Link>
            <Link to="/discover" aria-current={!mine ? 'page' : undefined}>
              发现
            </Link>
          </nav>
        ) : (
          <span className="page-brand">ahead</span>
        )}
        <div className="header-right">
          <Link className="avatar-button" to="/settings" aria-label="设置">
            {session?.identity.login.slice(0, 1).toUpperCase() ?? '⚙'}
          </Link>
        </div>
      </header>
      {loading && (
        <div className="loading-progress" role="status" aria-label="正在更新" />
      )}
      {!!errors.length &&
        (tab || storageError) &&
        dismissedErrors !== errors && (
          <div className="error-strip" role="status">
            <span>
              {storageError ? '部分更改未能保存到此设备' : '部分内容未能更新'}
            </span>
            {!storageError && (
              <button disabled={loading} onClick={() => void refresh()}>
                重试
              </button>
            )}
            <Link to="/settings#diagnostics">详情</Link>
            <button
              aria-label="关闭提示"
              onClick={() => setDismissedErrors(errors)}
            >
              ×
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
      {showUndo && undoProfile && !storageError && (
        <div className="undo-toast" role="status">
          已更新 <button onClick={undo}>撤销</button>
        </div>
      )}
    </div>
  )
}
