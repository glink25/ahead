import { PageSkeleton } from '../../app/PageSkeleton'
import { useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { activateSession } from '../../data/session'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuthSession } from '../../stores'
import { patProvider, oauthProvider } from '../../lib/auth'
export function LoginPage() {
  useFeatureTranslations('login')
  const { t } = useTranslation()

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
  if (loading) return <PageSkeleton variant="settings" />
  if (session) return <Navigate to="/profiles?choose=1" replace />
  return (
    <section className="login-view">
      <h1>{t('messages.sign_in_to_ahead')}</h1>
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
           {t('messages.continue_with_github')} </button>
      )}
      <details className="settings-group settings-disclosure">
        <summary>
           {t('messages.sign_in_with_an_access_token')} <ChevronRight />
        </summary>
        <form className="settings-body" onSubmit={loginWithPat}>
          <label>
             {t('messages.github_access_token')} <input
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
            {busy ? t('messages.signing_in_2') : t('messages.sign_in')}
          </button>
        </form>
      </details>
      {(error || restoreError) && (
        <p className="field-error" role="alert">
           {t('messages.sign_in_failed_check_your_credentials_and_retry')} </p>
      )}
    </section>
  )
}
