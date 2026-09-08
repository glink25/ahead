import { useMemo, useSyncExternalStore } from 'react'
import { useData } from '../../data/local'
import { marketApi } from '../../services/market'
import { addressKey, type ResourceAddress } from '../../services/resource-address'
import { useAuthSession } from '../../stores'
import type { ResourceQuerySnapshot } from '../../services/resource-query'
const invalid: ResourceQuerySnapshot = { loading: false, refreshing: false, error: { type: 'error', limited: false, reason: 'unavailable', message: 'messages.could_not_open_shared_resource' } }
const emptySubscribe = () => () => {}
const invalidSnapshot = () => invalid
export function useAddressedResource(address: ResourceAddress | undefined, kind: 'event-feed' | 'user-data', eventId?: string) {
  const session = useAuthSession((state) => state.session)
  const verified = useAuthSession((state) => state.verified)
  const db = useData((state) => state.db)
  const key = address ? addressKey(address) : ''
  const query = useMemo(() => address ? marketApi().query({ address, kind, eventId }) : undefined, [key, kind, eventId, session, verified, db])
  return useSyncExternalStore(query?.subscribe ?? emptySubscribe, query?.snapshot ?? invalidSnapshot)
}
