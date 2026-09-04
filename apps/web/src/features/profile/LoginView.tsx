import { ChevronRight } from 'lucide-react'
import { activateSession } from '../../data/session'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuthSession } from '../../stores'
import { patProvider, oauthProvider } from '../../lib/auth'
export function LoginPage() {
  const [token, setToken] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const { session, loading, setSession, restoreError, setRestoreError } =
    useAuthSession()
  const loginWithPat = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(false)
    setRestoreError(null)
    try {
      const auth = await patProvider.authenticate({ token })
      await activateSession(auth, true)
      setSession(auth)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  if (loading)
    return (
      <div className="empty-view" role="status">
        正在登录…
      </div>
    )
  if (session) return <Navigate to="/profiles?choose=1" replace />
  return (
    <section className="login-view">
      <h1>登录 Ahead</h1>
      {oauthProvider.available && (
        <button
          className="primary-link"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(false)
            sessionStorage.setItem('ahead-login-choice', '1')
            void oauthProvider
              .authenticate()
              .catch(() => setError(true))
              .finally(() => setBusy(false))
          }}
        >
          使用 GitHub 登录
        </button>
      )}
      <details className="settings-group settings-disclosure">
        <summary>
          使用访问令牌登录
          <ChevronRight />
        </summary>
        <form className="settings-body" onSubmit={loginWithPat}>
          <label>
            GitHub 访问令牌
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button
            className="primary-link"
            disabled={busy || !token.trim()}
            type="submit"
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      </details>
      {(error || restoreError) && (
        <p className="field-error" role="alert">
          登录未完成，请检查登录信息后重试。
        </p>
      )}
    </section>
  )
}
