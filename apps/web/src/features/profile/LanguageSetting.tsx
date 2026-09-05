import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changeLanguage, readLanguagePreference, type LanguagePreference } from '../../i18n'

export function LanguageSetting() {
  const { t } = useTranslation()
  const [preference, setPreference] = useState(readLanguagePreference)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <>
    <label className="setting-row">
      <span>{t('language.label')}</span>
      <select aria-label={t('language.label')} value={preference} disabled={busy}
        onChange={(event) => {
          const next = event.target.value as LanguagePreference
          const previous = preference
          setPreference(next)
          setBusy(true)
          setFailed(false)
          void changeLanguage(next)
            .catch(() => {
              setPreference(previous)
              setFailed(true)
            })
            .finally(() => setBusy(false))
        }}>
        <option value="auto">{t('language.auto')}</option>
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
    {busy && <p role="status">{t('language.loading')}</p>}
    {failed && <p role="alert">{t('language.failed')}</p>}
  </>
}
