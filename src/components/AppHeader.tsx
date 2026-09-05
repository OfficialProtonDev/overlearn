/**
 * The persistent header: where you are, how long you've been at it, and the
 * way out to the library or settings.
 *
 * The clock is informational only. It never interrupts, never gates anything,
 * and never turns red — you asked for pacing you can glance at, not a
 * timer that manages you.
 */

import { useEffect, useState } from 'react'
import { Library, Moon, Settings, Sun, SunMoon, Table2 } from 'lucide-react'
import { paths, useNavigate, type Route } from '../lib/router'
import { useStore } from '../state/store'
import { totalAnswered } from '../lib/progress'
import { packQuestions } from '../lib/progress'

/** Milliseconds since the tab was opened, ticking once a second. */
function useElapsed(active: boolean): number {
  const [start] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])

  return now - start
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

interface AppHeaderProps {
  route: Route
}

export function AppHeader({ route }: AppHeaderProps) {
  const { activePack, progress, settings, setTheme } = useStore()
  const navigate = useNavigate()
  const elapsed = useElapsed(settings.showTimer && !!activePack)

  const total = activePack ? packQuestions(activePack).length : 0
  const answered = totalAnswered(progress)

  const cycleTheme = () => {
    const order = ['system', 'light', 'dark'] as const
    const next = order[(order.indexOf(settings.theme) + 1) % order.length]
    setTheme(next)
  }

  const themeLabel = { system: 'System', light: 'Ledger', dark: 'Nocturne' }[settings.theme]
  const ThemeIcon = { system: SunMoon, light: Sun, dark: Moon }[settings.theme]

  return (
    <header className="appheader no-print">
      <div className="shell shell-wide appheader-inner">
        <div className="appheader-identity">
          <button
            type="button"
            className="appheader-mark"
            onClick={() => navigate(paths.coverage())}
            title="Coverage map"
          >
            Overlearn
          </button>

          {activePack && (
            <>
              <span className="appheader-sep" aria-hidden="true" />
              <button
                type="button"
                className="appheader-pack"
                onClick={() => navigate(paths.library())}
                title="Switch pack"
              >
                {activePack.manifest.title}
              </button>
            </>
          )}
        </div>

        <div className="spacer" />

        {activePack && (
          <div className="appheader-meta">
            {settings.showTimer && (
              <span className="appheader-stat" title="Time in this tab">
                <span className="t-label">Session</span>
                <b className="t-mono">{formatDuration(elapsed)}</b>
              </span>
            )}
            <span className="appheader-stat" title="Distinct questions answered at least once">
              <span className="t-label">Answered</span>
              <b className="t-mono">
                {answered}
                <span className="t-dimmer">/{total}</span>
              </b>
            </span>
          </div>
        )}

        <nav className="appheader-nav">
          {activePack && (
            <button
              type="button"
              className={`btn btn-quiet ${route.name === 'cheatsheet' ? 'is-current' : ''}`}
              onClick={() => navigate(paths.cheatsheet())}
            >
              <Table2 size={15} aria-hidden="true" />
              <span className="appheader-nav-label">Cheat sheet</span>
            </button>
          )}
          <button
            type="button"
            className={`btn btn-quiet ${route.name === 'library' ? 'is-current' : ''}`}
            onClick={() => navigate(paths.library())}
          >
            <Library size={15} aria-hidden="true" />
            <span className="appheader-nav-label">Packs</span>
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-icon"
            onClick={cycleTheme}
            title={`Theme: ${themeLabel}. Click to change.`}
          >
            <ThemeIcon size={16} aria-hidden="true" />
            <span className="visually-hidden">Theme: {themeLabel}</span>
          </button>
          <button
            type="button"
            className={`btn btn-quiet btn-icon ${route.name === 'settings' ? 'is-current' : ''}`}
            onClick={() => navigate(paths.settings())}
            title="Settings"
          >
            <Settings size={16} aria-hidden="true" />
            <span className="visually-hidden">Settings</span>
          </button>
        </nav>
      </div>
    </header>
  )
}
