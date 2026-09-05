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
import { patProvider, oauthProvider } from '../../lib/auth'
import { useData } from '../../data/local'
import { forgetSession } from '../../data/session'
import { setPaused, syncNow } from '../../data/scheduler'
import { sourceKey } from '@ahead/protocol'
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


  const { session, setSession, loading: authLoading } = useAuthSession()
  const { profile, act, refresh, loading } = useFeedStore()
  const { db, ready } = useData(),
    location = useLocation()
  const space = db?.spaces[db.active]
  const profileSource = space?.remote && !space.pending.length
    ? sourceKey({
        locator: 'github:' + space.remote.owner + '/' + space.remote.repo,
        manifestPath: space.remote.path,
      })
    : undefined
  const [message, setMessage] = useState('')
  if (location.hash === '#diagnostics')
    return <Navigate to="/settings/experimental#diagnostics" replace />
  if (!ready || authLoading) return <PageSkeleton variant="settings" />
  return (
    <section className="profile-view">
      <h1>{t('messages.settings')}</h1>
      <h2>{t('messages.profiles')}</h2>
      <div className="settings-group">
        <Link className="setting-row" to="/profiles">
          <span>
            <strong>{profileName(space)}</strong>
            <small className="profile-meta">
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
        {profileSource && (
          <Link className="setting-row" to={'/people/view?source=' + encodeURIComponent(profileSource)}>
            {t('messages.view_profile')} <ChevronRight />
          </Link>
        )}
        {!profileSource && (space?.remote || space?.provision) && (
          <div className="setting-row" aria-disabled="true">
            <span>
              {t('messages.view_profile')}
              <small className="profile-meta">{t('messages.sync_before_copying_link')}</small>
            </span>
          </div>
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
            className="setting-row danger"
            onClick={() => {
              void forgetSession()
                .then(() =>
                  (session.providerId === oauthProvider.id
                    ? oauthProvider
                    : patProvider
                  ).logout(),
                )
                .then(() => setSession(null))
                .catch(() => setMessage('messages.could_not_sign_out_please_retry'))
            }}
          >
             {t('messages.sign_out')} </button>
        )}
      </div>
      <h2>{t('messages.display_and_privacy')}</h2>
      <div className="settings-group">
        <LanguageSetting />
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
                {space.remote.owner}/{space.remote.repo}
              </p>
              {space.feed && (
                <p>
                   {t('messages.personal_events')}{space.feed.owner}/{space.feed.repo}
                </p>
              )}
            </div>
          </details>
        )}
        <button
          className="setting-row"
          disabled={loading}
          onClick={() => void refresh()}
        >
           {t('messages.refresh_channels')}<span>{loading ? t('messages.updating_2') : <RefreshCw />}</span>
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
