import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAuthSession } from '../stores'
import { useFeedStore } from '../stores/feed'
import { useSwipe } from '../hooks/useSwipe'
import { SegmentedControl } from '@ahead/ui'
export function TabShell({ children }: { children: ReactNode }) {
  const location = useLocation(), navigate = useNavigate()
  const [params] = useSearchParams()
  const mine = location.pathname === '/mine'
  const tab = mine || location.pathname === '/discover'
  const [menu, setMenu] = useState(false)
  const [previousTab, setPreviousTab] = useState('/discover')
  const { session } = useAuthSession()
  const { loading, errors, undoProfile, undo, refresh } = useFeedStore()
  const { offset, handlers } = useSwipe((direction) => {
    if (tab) navigate(direction === 'left' ? '/discover' : '/mine')
  })
  useEffect(() => { if (tab) setPreviousTab(location.pathname + location.search); setMenu(false) }, [location.pathname, location.search, tab])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (menu) setMenu(false); else if (!tab) navigate(previousTab); return }
      if (!tab || menu || (e.target as HTMLElement).closest('input,textarea,select,button,a,summary') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); navigate(e.key === 'ArrowLeft' ? '/mine' : '/discover') }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [tab, menu, navigate, previousTab])
  return <div className="app-shell">
    <header className="app-header"><div className="header-left">
      {!tab ? <Link to={previousTab} aria-label="关闭页面">← 返回</Link> : mine
        ? <button aria-label={params.get('view') === 'calendar' ? '切换时间轴' : '切换日历'} onClick={() => navigate('/mine?view=' + (params.get('view') === 'calendar' ? 'timeline' : 'calendar'))}>{params.get('view') === 'calendar' ? '☷ 时间轴' : '▦ 日历'}</button>
        : <span className="wordmark">ahead<span>✳</span></span>}
    </div><SegmentedControl className="segmented" aria-label="主导航"><Link to="/mine" aria-current={mine ? 'page' : undefined}>我的</Link><Link to="/discover" aria-current={location.pathname === '/discover' ? 'page' : undefined}>发现</Link></SegmentedControl>
      <div className="header-right"><button className="avatar-button" aria-expanded={menu} aria-controls="account-menu" aria-label="打开个人菜单" onClick={() => setMenu(!menu)}>{session?.identity.login.slice(0, 1).toUpperCase() ?? '☺'}</button></div>
    </header>
    {menu && <><button className="menu-backdrop" aria-label="关闭菜单" onClick={() => setMenu(false)} /><nav id="account-menu" className="account-menu" aria-label="个人菜单"><p>{session ? '@' + session.identity.login : '每一天，都值得期待。'}</p><Link to="/following">订阅管理 ↗</Link><Link to="/studio">Studio / 编辑事件 ↗</Link><Link to="/profile">个人资料与同步 ↗</Link>{!session && <Link to="/login">登录 GitHub ↗</Link>}<button onClick={() => { setMenu(false); void refresh() }}>刷新所有事件源</button></nav></>}
    {loading && <div className="loading-strip" role="status">正在更新开放事件源…</div>}
    {!!errors.length && <details className="error-strip"><summary>{errors.length} 条加载或存储提示</summary>{errors.map((error, i) => <p key={i}>{error}</p>)}<button disabled={loading} onClick={() => void refresh()}>重试</button></details>}
    <main className={tab ? 'tab-stage' : 'overlay-stage'} {...(tab ? handlers : {})} style={tab ? { transform: 'translateX(' + offset + 'px)', transition: offset ? 'none' : undefined } : undefined}>{children}</main>
    {undoProfile && <div className="undo-toast" role="status">已更新个人偏好 <button onClick={undo}>撤销</button></div>}
  </div>
}
