import { PageSkeleton } from '../../app/PageSkeleton'
import { profileName } from '../../lib/profile-name'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { LanguageSetting } from './LanguageSetting'
import { useTranslation } from 'react-i18next'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { useAuthSession } from '../../stores'
import { useFeedStore } from '../../stores/feed'
import { useWorkspace } from '../../services/workspace'
import { setPaused, syncNow } from '../../services/workspace'
import { localUserAddress, resourcePath } from '../../services/resource-address'
export function ProfileView() {
  useFeatureTranslations('settings')
  const { t, i18n } = useTranslation()
  const labels = {
  local: t('messages.on_this_device_only'),
  pending: t('messages.waiting_to_sync'),
  offline: t('messages.waiting_for_connection'),
  syncing: t('messages.syncing'),
  synced: t('messages.synced'),
  auth: t('messages.sign_in_required'),
  attention: t('messages.needs_attention'),
  paused: t('messages.paused'),
}


  const { session, loading: authLoading } = useAuthSession()
  const { profile, act, refresh, refreshing } = useFeedStore()
  const weekStartsOn =
    profile.settings?.weekStartsOn === 'sunday' ||
    profile.settings?.weekStartsOn === 'monday'
      ? profile.settings.weekStartsOn
      : 'auto'
  const { db, ready } = useWorkspace(),
    location = useLocation()
  const space = db?.spaces[db.active]
  const [message, setMessage] = useState('')
  if (location.hash === '#diagnostics')
    return <Navigate to="/settings/experimental#diagnostics" replace />
  if (!ready || authLoading) return <PageSkeleton variant="settings" />
  return (
    <section className="pb-10">
      <h1>{t('messages.settings')}</h1>
      <h2>{t('messages.profiles')}</h2>
      <div className="settings-group">
        <Link className="setting-row" to="/profiles">
          <span>
            <strong>{profileName(space)}</strong>
            <small className="mt-1.5 block text-xs font-normal text-muted">
              {space?.private === false ? t('messages.public') : t('messages.private')}
            </small>
          </span>
          <span>
             {t('messages.switch')} <ChevronRight />
          </span>
        </Link>
        <Link className="setting-row" to="/following">
           {t('messages.channels_and_following')} <ChevronRight />
        </Link>
        {space && (
          <Link className="setting-row" to={resourcePath('user-data', localUserAddress(space))}>
            {t('messages.view_profile')} <ChevronRight />
          </Link>
        )}
      </div>
      <h2>{t('messages.account')}</h2>
      <div className="settings-group">
        <div className="setting-row">
          <strong>{session ? '@' + session.identity.login : t('messages.not_signed_in')}</strong>
          {!session && (
            <Link to="/login">
               {t('messages.sign_in')} <ChevronRight />
            </Link>
          )}
        </div>
        {session && (
          <button
            className="setting-row text-[#b64e45]"
            onClick={() => {
              if (!window.confirm(t('messages.clear_all_local_data_for_this_site_all_local_profiles_unsynced_changes_cred')))
                return
              window.location.replace('/reset.html?lang=' + i18n.resolvedLanguage)
            }}
          >
             {t('messages.sign_out_and_clear_data')} </button>
        )}
      </div>
      <h2>{t('messages.display_and_privacy')}</h2>
      <div className="settings-group">
        <LanguageSetting />
        <label className="setting-row">
          <span>{t('messages.week_starts_on')}</span>
          <select
            aria-label={t('messages.week_starts_on')}
            value={weekStartsOn}
            onChange={(event) =>
              act({
                type: 'week-start',
                value:
                  event.target.value === 'auto'
                    ? undefined
                    : (event.target.value as 'sunday' | 'monday'),
              })
            }
          >
            <option value="auto">{t('messages.follow_locale')}</option>
            <option value="sunday">{t('messages.sunday')}</option>
            <option value="monday">{t('messages.monday')}</option>
          </select>
        </label>
        <label className="setting-row">
           {t('messages.load_external_images')} <input
            role="switch"
            type="checkbox"
            checked={!profile.settings?.privacyRemoteImages}
            onChange={(e) =>
              act({ type: 'privacy', enabled: !e.target.checked })
            }
          />
        </label>
      </div>
      <h2>{t('messages.data_and_sync')}</h2>
      <div className="settings-group">
        <div className="setting-row">
          <span>{space ? labels[space.status] : t('messages.opening_profile')}</span>
          {space?.lastSynced && (
            <small>{new Date(space.lastSynced).toLocaleTimeString(i18n.resolvedLanguage)}</small>
          )}
        </div>
        {space?.account && (
          <>
            <button
              className="setting-row"
              onClick={() =>
                void syncNow(space.id).catch(() =>
                  setMessage('messages.could_not_sync_please_retry'),
                )
              }
              disabled={space.status === 'syncing' || !session}
            >
               {t('messages.sync_now')} <RefreshCw />
            </button>
            <button
              className="setting-row"
              onClick={() =>
                void setPaused(space.id, !space.paused).catch(() =>
                  setMessage('messages.could_not_save_settings'),
                )
              }
            >
              {space.paused ? t('messages.resume_automatic_sync') : t('messages.pause_automatic_sync')}
            </button>
          </>
        )}
        {(space?.status === 'auth' || space?.status === 'attention') && (
          <Link
            className="setting-row"
            to={space.status === 'auth' ? '/login' : '/profiles'}
          >
            {space.status === 'auth' ? t('messages.sign_in_again') : t('messages.check_profile_and_repository_permissions')}
            <ChevronRight />
          </Link>
        )}
        {space?.remote && (
          <details className="settings-disclosure">
            <summary>
               {t('messages.sync_destination')} <ChevronRight />
            </summary>
            <div className="settings-body">
              <p>
                {space.remote.locator}
              </p>
              {space.feed && (
                <p>
                   {t('messages.personal_events')}{space.feed.locator}
                </p>
              )}
            </div>
          </details>
        )}
        <button
          className="setting-row"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
           {t('messages.refresh_channels')}<span>{refreshing ? t('messages.updating_2') : <RefreshCw />}</span>
        </button>
      </div>
      {message && (
        <p role="status" className="feedback">
          {displayMessage(message)}
        </p>
      )}
      <h2>{t('messages.advanced')}</h2>
      <div className="settings-group">
        <Link className="setting-row" to="/settings/experimental">
           {t('messages.experimental_settings')} <ChevronRight />
        </Link>
      </div>
    </section>
  )
}
