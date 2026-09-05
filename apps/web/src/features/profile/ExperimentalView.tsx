import { displayMessage } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { ChevronRight, Trash2 } from 'lucide-react'
import { useData } from '../../data/local'
import { useFeedStore } from '../../stores/feed'

export function ExperimentalView() {
  const { t, i18n } = useTranslation()

  const errors = useFeedStore((s) => s.errors)
  const space = useData((s) => s.db?.spaces[s.db.active])
  const location = useLocation()
  const [clearing, setClearing] = useState(false)
  return (
    <section className="profile-view">
      <h1>{t('messages.experimental_settings')}</h1>
      <div className="settings-group">
        <details
          id="diagnostics"
          className="settings-disclosure"
          open={location.hash === '#diagnostics' || undefined}
        >
          <summary>
             {t('messages.diagnostics')} <ChevronRight />
          </summary>
          <div className="settings-body diagnostic-output">
            {errors.map((error, i) => (
              <p key={i}>{displayMessage(error)}</p>
            ))}
            {space?.error && <p>{displayMessage(space.error)}</p>}
            {!errors.length && !space?.error && <p>{t('messages.no_issues')}</p>}
          </div>
        </details>
      </div>
      <h2>{t('messages.local_data')}</h2>
      <p className="muted">
         {t('messages.clear_all_profiles_sign_in_information_and_caches_for_this_site_in_this_bro')} </p>
      <div className="settings-group">
        <button
          className="setting-row danger"
          disabled={clearing}
          onClick={() => {
            if (
              !window.confirm(
                t('messages.clear_all_local_data_for_this_site_all_local_profiles_unsynced_changes_cred'),
              )
            )
              return
            setClearing(true)
            window.location.replace('/reset.html?lang=' + i18n.resolvedLanguage)
          }}
        >
          {clearing ? t('messages.clearing') : t('messages.clear_data')}
          <Trash2 />
        </button>
      </div>
    </section>
  )
}
