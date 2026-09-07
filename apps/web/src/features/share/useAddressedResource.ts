import { useEffect, useState } from 'react'
import { useData } from '../../data/local'
import { marketApi } from '../../services/market'
import type { ReadEvent } from '../../services/market-api'
import type { ResourceAddress } from '../../services/resource-address'
import { useAuthSession } from '../../stores'

type ResourceEvent = Extract<ReadEvent, { type: 'feed' | 'user' }>

export function useAddressedResource(
  address: ResourceAddress | undefined,
  kind: 'event-feed' | 'user-data',
  eventId?: string,
) {
  const identity = useAuthSession((state) => state.session?.identity.id)
  const verified = useAuthSession((state) => state.verified)
  const localSpace = useData((state) =>
    address?.scheme === 'local' ? state.db?.spaces[address.spaceId] : undefined,
  )
  const [state, setState] = useState<{
    loading: boolean
    resource?: ResourceEvent
    error?: Extract<ReadEvent, { type: 'error' }>
  }>({ loading: true })
  const key = address ? JSON.stringify(address) : ''

  useEffect(() => {
    if (!address) {
      setState({
        loading: false,
        error: {
          type: 'error',
          message: 'messages.could_not_open_shared_resource',
          reason: 'unavailable',
          limited: false,
        },
      })
      return
    }
    const controller = new AbortController()
    setState({ loading: true })
    void (async () => {
      for await (const event of marketApi().sources.open({
        address,
        kind,
        eventId,
        refresh: true,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return
        if (event.type === 'error')
          setState((current) => ({ ...current, loading: false, error: event }))
        else
          setState((current) => ({
            loading: false,
            resource: event,
            error: event.cached ? current.error : undefined,
          }))
      }
    })().catch((error) => {
      if (!controller.signal.aborted)
        setState((current) => ({
          ...current,
          loading: false,
          error: {
            type: 'error',
            message: String(error),
            reason: 'unavailable',
            limited: false,
          },
        }))
    })
    return () => controller.abort()
  }, [key, kind, eventId, identity, verified, localSpace])

  return state
}
