/**
 * A last line of defence around the whole app.
 *
 * React tears the entire tree down when a render throws, so without this one
 * bad component leaves a blank white page. That is bad enough live, and worse
 * on reload: when the state that caused it was persisted — and the cheat
 * sheet's settings are — the reloaded app lands straight back on the same
 * blank page. The only exit left is clearing site data, which also throws away
 * every answer the user has recorded.
 *
 * So catch it, say plainly what happened, and offer the two ways out that cost
 * nothing. Progress lives under its own keys and is never touched by either.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { SHEET_SETTINGS_KEY } from '../lib/sheet'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="app">
        <div className="shell shell-narrow view">
          <div className="panel empty">
            <p className="t-h3">Something went wrong</p>
            <p className="prose t-small">
              The page hit an error and stopped drawing. Your packs and everything you've answered
              are stored separately and are untouched.
            </p>

            <pre className="error-detail t-tiny t-dimmer">{error.message}</pre>

            <div className="row gap-2 wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  // If it comes back on every reload, the cause is something
                  // saved. The cheat sheet's display settings are the only
                  // thing here that is both persisted and free to discard.
                  try {
                    localStorage.removeItem(SHEET_SETTINGS_KEY)
                  } catch {
                    /* storage unavailable; the reload is still worth trying */
                  }
                  window.location.reload()
                }}
              >
                Reset cheat sheet settings and reload
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
