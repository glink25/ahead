import { useEffect, useState } from 'react'
import type { UserData } from '@ahead/schema'
import type { AddressedEvent } from '../services/market-api'
import { observePersonEvents } from '../services/person-events'
import { useAuthSession } from '../stores'
export function usePersonEvents(user?: UserData) {
  const auth = useAuthSession()
  const [state, setState] = useState<{ events: AddressedEvent[]; loading: boolean; error?: string }>({ events: [], loading: false })
  useEffect(() => user ? observePersonEvents(user, setState) : undefined, [user, auth.session, auth.verified])
  return state
}
