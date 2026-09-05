import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { SharedResource } from '../../services/shared-resource'

export function CopyLinkButton({ url }: { url?: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const absolute = url ? new URL(url, location.origin).href : ''
  useEffect(() => setState('idle'), [absolute])
  const copy = async () => {
    if (!absolute) return
    try {
      await navigator.clipboard.writeText(absolute)
      setState('copied')
      window.setTimeout(() => setState('idle'), 1800)
    } catch {
      setState('manual')
    }
  }
  return (
    <div className="copy-link-control">
      <button className="primary-link" disabled={!absolute} onClick={() => void copy()}>
        {state === 'copied' ? <Check /> : <Copy />}
        {state === 'copied' ? t('messages.link_copied') : t('messages.copy_link')}
      </button>
      {!absolute && <small>{t('messages.sync_before_copying_link')}</small>}
      {state === 'manual' && (
        <label>
          {t('messages.copy_this_address')}
          <input readOnly value={absolute} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
    </div>
  )
}

export function ResourceFailure({ error }: { error: Error & { reason?: string } }) {
  const { t } = useTranslation()
  const location = useLocation()
  const returnTo = location.pathname + location.search
  return (
    <section className="empty-view" role="alert">
      <p>
        {error.reason === 'auth'
          ? t('messages.sign_in_to_view_this_resource')
          : t('messages.could_not_open_shared_resource')}
      </p>
      {error.reason === 'auth' && (
        <Link className="primary-link" to={'/login?returnTo=' + encodeURIComponent(returnTo)}>
          {t('messages.sign_in_to_github')}
        </Link>
      )}
    </section>
  )
}

export function VisibilityBadge({ resource }: { resource: SharedResource }) {
  const { t } = useTranslation()
  return <small className="resource-visibility">{resource.private ? t('messages.private') : t('messages.public')}</small>
}
