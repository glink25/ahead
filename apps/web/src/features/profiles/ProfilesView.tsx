import { profileName } from '../../lib/profile-name'
import { displayMessage } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { previousUrl } from '../../app/navigation'
import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuthSession } from '../../stores'
import {
  useData,
  createLocalProfile,
  database,
  changed,
} from '../../data/local'
import { connectProfile, discoverProfiles } from '../../data/profiles'
import { chooseProfile } from '../../data/session'
import { syncNow } from '../../data/scheduler'
export function ProfilesView() {
  const { t, i18n } = useTranslation()

  const { session } = useAuthSession(),
    { db } = useData()
  const navigate = useNavigate()
  const [name, setName] = useState(''),
    [privateRepo, setPrivate] = useState(true)
  const [bio, setBio] = useState('')
  const [address, setAddress] = useState(''),
    [path, setPath] = useState('ahead.yaml')
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const account = session ? String(session.identity.id) : undefined
  const profiles = Object.values(db?.spaces ?? {}).filter(
    (s) => s.id !== 'guest' && (s.account === account || !s.account),
  )
  useEffect(() => {
    if (!session || !navigator.onLine) return
    const controller = new AbortController()
    void discoverProfiles(session, setMessage, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setMessage('')
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage('messages.cannot_find_more_profiles_right_now_use_a_cached_profile_or_add_one_by_addr')
      })
    return () => controller.abort()
  }, [session?.identity.id])
  const select = async (id: string) => {
    setBusy(true)
    try {
      await chooseProfile(id, session)
      previousUrl()?.startsWith('/mine')
        ? navigate(-1)
        : navigate('/mine', { replace: true })
    } catch {
      setMessage('messages.could_not_switch_profiles_local_data_has_been_preserved')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="profiles-view">
      <h1>{t('messages.profiles')}</h1>
      <p className="muted">
        {session ? '@' + session.identity.login : t('messages.local_profile')}
      </p>
      <div className="profile-list">
        {profiles.map((space) => (
          <article className="settings-group" key={space.id}>
            <button
              className="setting-row"
              disabled={busy}
              onClick={() => void select(space.id)}
            >
              <span>
                <strong>{profileName(space)}</strong>
                <small className="profile-meta">
                  {space.private ? t('messages.private') : t('messages.public')}
                  {space.remote
                    ? ' · ' + space.remote.owner + '/' + space.remote.repo
                    : t('messages.local')}
                </small>
              </span>
              <span>{space.id === db?.active ? t('messages.current') : <ChevronRight />}</span>
            </button>
            {(space.provision || space.feedProvision) &&
              space.status === 'attention' && (
                <details className="settings-disclosure">
                  <summary>{t('messages.change_the_new_repository_name')}</summary>
                  <form
                    className="settings-body"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const form = new FormData(e.currentTarget)
                      void database
                        .transaction((value) => {
                          const s = value.spaces[space.id]!
                          const key = s.remote ? 'feedProvision' : 'provision'
                          if (s[key])
                            s[key]!.repo = String(form.get('repo')).trim()
                        })
                        .then(() => {
                          changed()
                          void syncNow(space.id)
                        })
                    }}
                  >
                    <input
                      name="repo"
                      required
                      pattern="[A-Za-z0-9_.-]+"
                      defaultValue={
                        (space.remote ? space.feedProvision : space.provision)
                          ?.repo
                      }
                    />
                    <button className="primary-link">{t('messages.retry_creation')}</button>
                  </form>
                </details>
              )}
          </article>
        ))}
      </div>
      <details
        className="settings-group settings-disclosure"
        open={!profiles.length}
      >
        <summary>
           {t('messages.new_profile')} <Plus />
        </summary>
        <form
          className="settings-body"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            void createLocalProfile(name.trim(), privateRepo, account, bio, i18n.resolvedLanguage || 'en')
              .then((id) => chooseProfile(id, session))
              .then(() =>
                previousUrl()?.startsWith('/mine')
                  ? navigate(-1)
                  : navigate('/mine', { replace: true }),
              )
              .catch(() => setMessage('messages.could_not_create_profile_check_local_storage_and_retry'))
              .finally(() => setBusy(false))
          }}
        >
          <label>
             {t('messages.name')} <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('messages.for_example_my_ahead_work_games')}
            />
          </label>
          <label>
             {t('messages.bio_optional')} <textarea value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          <label className="setting-row">
             {t('messages.visibility')} <select
              value={privateRepo ? 'private' : 'public'}
              onChange={(e) => setPrivate(e.target.value === 'private')}
            >
              <option value="private">{t('messages.private')}</option>
              <option value="public">{t('messages.public')}</option>
            </select>
          </label>
          <button className="primary-link" disabled={busy || !name.trim()}>
             {t('messages.create_and_use')} </button>
        </form>
      </details>
      {session && (
        <details className="settings-group settings-disclosure">
          <summary>
             {t('messages.add_by_repository_address')} <Plus />
          </summary>
          <form
            className="settings-body"
            onSubmit={(e) => {
              e.preventDefault()
              setBusy(true)
              void connectProfile(session, address.trim(), path.trim())
                .then((id) => select(id))
                .catch(() =>
                  setMessage('messages.could_not_add_profile_check_the_address_file_format_and_repository_permissi'),
                )
                .finally(() => setBusy(false))
            }}
          >
            <label>
               {t('messages.repository_address')} <input
                required
                placeholder="github:owner/ahead-user-main"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label>
               {t('messages.profile_file_path')} <input
                required
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            <button className="primary-link" disabled={busy}>
               {t('messages.add_and_use')} </button>
          </form>
        </details>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void select('guest')}
      >
         {t('messages.continue_with_local_profile')} </button>
      {message && (
        <p className="feedback" role="status">
          {displayMessage(message)}
        </p>
      )}
    </section>
  )
}
