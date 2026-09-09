import { PageSkeleton } from '../../app/PageSkeleton'
import { profileName } from '../../lib/profile-name'
import { displayMessage, useFeatureTranslations } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { previousUrl } from '../../app/navigation'
import { ChevronRight, Ellipsis, ExternalLink, Plus, Share2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuthSession } from '../../stores'
import type { Space } from '@ahead/sync'
import type { ProfileAction } from '../../adapters/sync'
import {
  useWorkspace,
  createLocalProfile,
  profileOperations,
  renamePendingTarget,
} from '../../services/workspace'
import { connectProfile, discoverProfiles } from '../../services/workspace'
import { chooseProfile } from '../../services/workspace'

function ProfileActions({
  space,
  activeSpaceId,
  disabled,
  onSelect,
}: {
  space: Space
  activeSpaceId: string
  disabled: boolean
  onSelect: (action: ProfileAction) => void
}) {
  const { t } = useTranslation()
  const actions = profileOperations(space).profileActions(space, activeSpaceId)
  if (!actions.length) return null
  return (
    <details className="relative shrink-0">
      <summary
        className="grid min-h-[58px] min-w-[58px] list-none place-items-center"
        aria-label={t('messages.more_profile_actions')}
      >
        <Ellipsis />
      </summary>
      <div className="absolute right-2 top-[calc(100%-6px)] z-20 min-w-[180px] overflow-hidden rounded-xl border border-line bg-panel shadow-[0_12px_30px_#0003]">
        {actions.map((action) => (
          <button
            className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${action.type === 'delete' ? 'text-[#b64e45]' : ''}`}
            disabled={disabled || Boolean(action.mode === 'execute' && action.disabledReason)}
            key={action.type}
            title={action.mode === 'execute' && action.disabledReason === 'active-profile' ? t('messages.switch_profiles_before_deleting') : undefined}
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              onSelect(action)
            }}
          >
            {action.type === 'share' ? <Share2 size={18} /> : <Trash2 size={18} />}
            <span>
              {t(action.type === 'share' ? 'messages.share_profile' : 'messages.delete_profile')}
              {action.mode === 'execute' && action.disabledReason === 'active-profile' && (
                <small className="mt-1 block text-xs text-muted">{t('messages.switch_profiles_before_deleting')}</small>
              )}
            </span>
          </button>
        ))}
      </div>
    </details>
  )
}

export function ProfilesView() {
  useFeatureTranslations('profiles')
  const { t, i18n } = useTranslation()

  const { session } = useAuthSession(),
    { db, ready } = useWorkspace()
  const navigate = useNavigate()
  const [name, setName] = useState(''),
    [privateRepo, setPrivate] = useState(true)
  const [bio, setBio] = useState('')
  const [address, setAddress] = useState(''),
    [path, setPath] = useState('ahead.yaml')
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const [selectedAction, setSelectedAction] = useState<{
    profileName: string
    action: ProfileAction
  }>()
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
  const executeSelectedAction = async () => {
    const action = selectedAction?.action
    if (!action || action.mode !== 'execute') return
    setBusy(true)
    try {
      await action.execute()
      setSelectedAction(undefined)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'messages.could_not_delete_profile')
    } finally {
      setBusy(false)
    }
  }
  if (!ready || !db) return <PageSkeleton variant="settings" />
  return (
    <section className="[&>.settings-group]:my-4">
      <h1>{t('messages.profiles')}</h1>
      <p className="muted">
        {session ? '@' + session.identity.login : t('messages.local_profile')}
      </p>
      <div className="my-6 grid gap-3">
        {profiles.map((space) => (
          <article className="settings-group overflow-visible" key={space.id}>
            <div className="flex items-stretch">
              <button
                className="setting-row min-w-0 flex-1 border-b-0 pr-2"
                disabled={busy}
                onClick={() => void select(space.id)}
              >
                <span className="min-w-0">
                  <strong>{profileName(space)}</strong>
                  <small className="mt-1.5 block truncate text-xs font-normal text-muted">
                    {space.private ? t('messages.private') : t('messages.public')}
                    {space.remote
                      ? ' · ' + space.remote.locator
                      : t('messages.local')}
                  </small>
                </span>
                <span>{space.id === db?.active ? t('messages.current') : <ChevronRight />}</span>
              </button>
              <ProfileActions
                space={space}
                activeSpaceId={db.active}
                disabled={busy}
                onSelect={(action) => setSelectedAction({ profileName: profileName(space), action })}
              />
            </div>
            {(space.provision || space.feedProvision) &&
              space.status === 'attention' && (
                <details className="settings-disclosure">
                  <summary>{t('messages.change_the_new_repository_name')}</summary>
                  <form
                    className="settings-body"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const form = new FormData(e.currentTarget)
                      void renamePendingTarget(space.id, String(form.get('repo'))).catch(() => setMessage('messages.could_not_sync_please_retry'))
                    }}
                  >
                    <input
                      name="repo"
                      required
                      pattern="[A-Za-z0-9_.-]+"
                      defaultValue={
                        (space.remote ? space.feedProvision : space.provision)
                          ?.name
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
      {selectedAction && (
        <div
          className="fixed inset-0 z-60 grid place-items-center bg-[#0007] p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setSelectedAction(undefined)
          }}
        >
          <section
            className="grid w-full max-w-[460px] gap-[18px] rounded-[20px] bg-panel p-6 shadow-[0_20px_60px_#0004] [&_h2]:text-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-action-title"
          >
            <h2 id="profile-action-title">
              {t(selectedAction.action.type === 'share' ? 'messages.share_profile_name' : 'messages.delete_profile_name', { name: selectedAction.profileName })}
            </h2>
            {selectedAction.action.mode === 'external' ? (
              <>
                <p className="muted">
                  {t(selectedAction.action.type === 'share' ? 'messages.github_share_guidance' : 'messages.github_delete_guidance')}
                </p>
                <div className="grid gap-2">
                  {selectedAction.action.targets.map((target) => (
                    <a
                      className="setting-row rounded-xl border border-line bg-surface"
                      href={target.url}
                      key={`${target.kind}:${target.locator}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="min-w-0">
                        <strong>{t(target.kind === 'profile' ? 'messages.profile_repository' : 'messages.personal_events_repository')}</strong>
                        <small className="mt-1 block truncate text-xs text-muted">{target.locator}</small>
                      </span>
                      <ExternalLink size={18} />
                    </a>
                  ))}
                </div>
                <button disabled={busy} onClick={() => setSelectedAction(undefined)}>
                  {t('messages.close')}
                </button>
              </>
            ) : (
              <>
                <p className="muted">{t('messages.local_profile_delete_confirmation')}</p>
                <button
                  className="primary-link bg-[#b64e45] text-white"
                  disabled={busy}
                  onClick={() => void executeSelectedAction()}
                >
                  {busy ? t('messages.deleting') : t('messages.delete_permanently')}
                </button>
                <button disabled={busy} onClick={() => setSelectedAction(undefined)}>
                  {t('messages.cancel')}
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
