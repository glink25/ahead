import { useEffect, useState } from 'react'
import { loadSharedResource, type SharedResource } from '../../services/shared-resource'
import { useAuthSession } from '../../stores'

export function useSharedResource(key: string | null, kind: 'event-feed' | 'user-data') {
  const identity = useAuthSession((state) => state.session?.identity.id)
  const [state, setState] = useState<{
    loading: boolean
    resource?: SharedResource
    error?: Error
  }>({ loading: true })
  useEffect(() => {
    if (!key) {
      setState({ loading: false, error: Object.assign(new Error('Missing source'), { reason: 'invalid' }) })
      return
    }
    const controller = new AbortController()
    setState({ loading: true })
    void loadSharedResource(key, kind, controller.signal).then(
      (resource) => !controller.signal.aborted && setState({ loading: false, resource }),
      (error) => {
        if (!controller.signal.aborted && error?.name !== 'AbortError')
          setState({ loading: false, error: error instanceof Error ? error : new Error(String(error)) })
      },
    )
    return () => controller.abort()
  }, [key, kind, identity])
  return state
}
