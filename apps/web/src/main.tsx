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
  initializeI18n()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </StrictMode>,
  )
  if (import.meta.env.PROD) void cacheLoadedLanguages()
}

if (!resetting && import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    /* Online use remains available if the browser disallows offline caching. */
  })
}
