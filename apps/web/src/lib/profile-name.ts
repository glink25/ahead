import type { Space } from '@ahead/sync'
import { materializeProfile } from '../data/model'
import { i18n } from '../i18n'
import { pickText } from './format'

export function profileName(space: Space | undefined): string {
  if (!space || space.id === 'guest') return i18n.t('messages.local_profile')
  const profile = materializeProfile(space.records)
  return pickText(profile.displayName) || space.name
}
