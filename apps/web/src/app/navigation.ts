import { useCallback, useLayoutEffect } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router'

const key = 'ahead-navigation'
type Entry = { key: string; url: string }
type Trail = { entries: Entry[]; current: number }
function read(): Trail {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (
      Array.isArray(value?.entries) &&
      Number.isInteger(value.current) &&
      value.current >= 0 &&
      value.current < value.entries.length &&
      value.entries.every(
        (entry: Entry) =>
          typeof entry?.key === 'string' && typeof entry?.url === 'string',
      )
    )
      return value
    return { entries: [], current: -1 }
  } catch {
    return { entries: [], current: -1 }
  }
}
export function fallbackFor(path: string, search: string): string {
  if (path === '/settings/experimental') return '/settings'
  if (path === '/studio') {
    const event = new URLSearchParams(search).get('event')
    if (event) return '/events/' + encodeURIComponent(event)
  }
  return path === '/settings' || path === '/login' ? '/discover' : '/mine'
}
export function previousUrl(): string | undefined {
  const trail = read()
  return trail.entries[trail.current - 1]?.url
}
export function useAppBack() {
  const location = useLocation(),
    navigate = useNavigate()
  return useCallback(() => {
    if (previousUrl()) navigate(-1)
    else
      navigate(fallbackFor(location.pathname, location.search), {
        replace: true,
      })
  }, [navigate, location.pathname, location.search])
}
/** A per-tab journal of router keys, not a second navigation stack. POP never pushes. */
export function useNavigationJournal() {
  const location = useLocation(),
    kind = useNavigationType()
  useLayoutEffect(() => {
    const trail = read()
    const entry = {
      key: location.key,
      url: location.pathname + location.search + location.hash,
    }
    const found = trail.entries.findIndex((item) => item.key === entry.key)
    if (found >= 0) {
      trail.current = found
      trail.entries[found] = entry
    } else if (kind === 'PUSH') {
      trail.entries = [...trail.entries.slice(0, trail.current + 1), entry]
      trail.current = trail.entries.length - 1
    } else if (kind === 'REPLACE' && trail.current >= 0) {
      trail.entries[trail.current] = entry
    } else {
      trail.entries = [entry]
      trail.current = 0
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(trail))
    } catch {
      /* Direct-entry fallback remains usable. */
    }
  }, [location, kind])
}
