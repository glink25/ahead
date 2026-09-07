import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { ReadEvent } from '../../services/market-api'

export function CopyLinkButton({ url }: { url: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const absolute = new URL(url, location.origin).href
  useEffect(() => setState('idle'), [absolute])
  const copy = async () => {
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
      <button className="primary-link" onClick={() => void copy()}>
        {state === 'copied' ? <Check /> : <Copy />}
        {state === 'copied' ? t('messages.link_copied') : t('messages.copy_link')}
      </button>
      {state === 'manual' && (
        <label>
          {t('messages.copy_this_address')}
          <input readOnly value={absolute} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
    </div>
  )
}

type ReadFailure = Extract<ReadEvent, { type: 'error' }>

export function ResourceFailure({ error }: { error?: ReadFailure }) {
  const { t } = useTranslation()
  const location = useLocation()
  const returnTo = location.pathname + location.search
  return (
    <section className="empty-view" role="alert">
      <p>
        {error?.reason === 'auth'
          ? t('messages.sign_in_to_view_this_resource')
          : error?.reason === 'local-missing'
            ? t('messages.local_resource_belongs_to_another_device')
          : t('messages.could_not_open_shared_resource')}
      </p>
      {error?.reason === 'auth' && (
        <Link className="primary-link" to={'/login?returnTo=' + encodeURIComponent(returnTo)}>
          {t('messages.sign_in_to_github')}
        </Link>
      )}
    </section>
  )
}

export function VisibilityBadge({ resource }: {
  resource: Extract<ReadEvent, { type: 'feed' | 'user' }>
}) {
  const { t } = useTranslation()
  return (
    <small className="resource-visibility">
      {resource.visibility === 'local'
        ? t('messages.on_this_device_only')
        : resource.visibility === 'private'
          ? t('messages.private')
          : t('messages.public')}
    </small>
  )
}
