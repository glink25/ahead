import { StrictMode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { i18n, initializeI18n, cacheLoadedLanguages } from './i18n'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { installResetListener } from './lib/reset-listener'
import { App } from './App'
import './index.css'

const resetting = installResetListener()
const router = createBrowserRouter([{ path: '*', element: <App /> }])

if (!resetting) {
  const root = createRoot(document.getElementById('root')!)
  const start = () => {
    root.render(<div className="empty-view" role="status">Loading… / 正在加载…</div>)
    void initializeI18n().then(() => {
      root.render(
        <StrictMode>
          <I18nextProvider i18n={i18n}>
            <RouterProvider router={router} />
          </I18nextProvider>
        </StrictMode>,
      )
      if (import.meta.env.PROD) void cacheLoadedLanguages()
    }).catch(() => root.render(
      <div className="empty-view" role="alert">
        <p>Could not load language. Check your connection. / 无法加载语言，请检查网络。</p>
        <button onClick={start}>Retry / 重试</button>
      </div>,
    ))
  }
  start()
}

if (!resetting && import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    /* Online use remains available if the browser disallows offline caching. */
  })
}
