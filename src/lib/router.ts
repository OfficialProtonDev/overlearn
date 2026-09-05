/**
 * A hash router, in about eighty lines.
 *
 * Hash routing rather than history routing specifically because this deploys
 * to GitHub Pages: no server rewrites are available there, so a deep link to
 * /pack/x/session under history routing would 404 on refresh. With hashes it
 * works from any static host, at any base path, with no configuration.
 */

import { useCallback, useEffect, useState } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'coverage' }
  | { name: 'topic'; topicId: string }
  | { name: 'subtopic'; subtopicId: string }
  | { name: 'session'; mode: string; scope: string }
  | { name: 'cheatsheet' }
  | { name: 'settings' }

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  const [pathPart, queryPart] = path.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const query = new URLSearchParams(queryPart ?? '')

  if (segments.length === 0) return { name: 'coverage' }

  switch (segments[0]) {
    case 'library':
      return { name: 'library' }
    case 'settings':
      return { name: 'settings' }
    case 'cheatsheet':
      return { name: 'cheatsheet' }
    case 'topic':
      return segments[1] ? { name: 'topic', topicId: decodeURIComponent(segments[1]) } : { name: 'coverage' }
    case 'subtopic':
      return segments[1]
        ? { name: 'subtopic', subtopicId: decodeURIComponent(segments[1]) }
        : { name: 'coverage' }
    case 'session':
      return {
        name: 'session',
        mode: segments[1] ?? 'quiz',
        scope: query.get('scope') ?? '',
      }
    default:
      return { name: 'coverage' }
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

/**
 * A value that changes on every navigation, including a navigation to the
 * hash that is already current.
 *
 * Views that hold their own run of something — a session queue, most of all —
 * are keyed on this. Without it, "Another round" navigates to the same URL,
 * the route object compares equal, and the finished session stays on screen
 * instead of a new one starting.
 */
export function useNavigationKey(): number {
  const [seq, setSeq] = useState(0)

  useEffect(() => {
    const bump = () => setSeq((n) => n + 1)
    window.addEventListener('hashchange', bump)
    return () => window.removeEventListener('hashchange', bump)
  }, [])

  return seq
}

export function navigate(path: string): void {
  const next = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`
  if (window.location.hash === next) {
    // Re-dispatch so a repeated navigation (e.g. "start another session")
    // still resets the view.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = next
}

export function useNavigate(): (path: string) => void {
  return useCallback((path: string) => navigate(path), [])
}

/* ------------------------------------------------------------------ *
 * Path builders — the only place route strings are assembled
 * ------------------------------------------------------------------ */

export const paths = {
  coverage: () => '/',
  library: () => '/library',
  settings: () => '/settings',
  cheatsheet: () => '/cheatsheet',
  topic: (topicId: string) => `/topic/${encodeURIComponent(topicId)}`,
  subtopic: (subtopicId: string) => `/subtopic/${encodeURIComponent(subtopicId)}`,
  session: (mode: string, subtopicIds: string[] = []) => {
    const scope = subtopicIds.join(',')
    return `/session/${mode}${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`
  },
}

/** Split a session scope back into subtopic ids. */
export function parseScope(scope: string): string[] {
  return scope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Scroll to the top whenever the route changes. */
export function useScrollReset(route: Route): void {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [route.name, JSON.stringify(route)])
}
