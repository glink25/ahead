import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { installResetListener } from './lib/reset-listener'
import { App } from './App'
import './index.css'

const resetting = installResetListener()
const router = createBrowserRouter([{ path: '*', element: <App /> }])

if (!resetting)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )

if (!resetting && import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    /* Online use remains available if the browser disallows offline caching. */
  })
}
