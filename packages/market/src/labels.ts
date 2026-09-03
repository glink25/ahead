export const APPROVED_LABEL = 'approved'
export const REJECTED_LABEL = 'rejected'
export const NEEDS_CHANGES_LABEL = 'needs-changes'

export const EVENT_FEED_TYPE_LABEL = 'type:event-feed'
export const USER_DATA_TYPE_LABEL = 'type:user-data'

export const TRUST_COMMUNITY_LABEL = 'trust:community'
export const TRUST_VERIFIED_LABEL = 'trust:verified'
export const TRUST_OFFICIAL_LABEL = 'trust:official'

export const TYPE_LABELS = [EVENT_FEED_TYPE_LABEL, USER_DATA_TYPE_LABEL] as const
export const TRUST_LABELS = [
  TRUST_COMMUNITY_LABEL,
  TRUST_VERIFIED_LABEL,
  TRUST_OFFICIAL_LABEL,
] as const
