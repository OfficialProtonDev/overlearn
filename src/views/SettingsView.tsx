/**
 * Settings, and the honest account of where your data lives.
 */

import { useRef, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { useStore } from '../state/store'
import { exportProgress, parseProgressExport, type ThemeChoice } from '../lib/storage'
import { formatDuration } from '../components/AppHeader'
import { totalAnswered } from '../lib/progress'

const THEMES: { value: ThemeChoice; label: string; detail: string }[] = [
  { value: 'system', label: 'Match system', detail: 'Follows your OS light/dark setting' },
  { value: 'light', label: 'Ledger', detail: 'Cool paper, serif questions, ruled lines' },
  { value: 'dark', label: 'Nocturne', detail: 'Warm charcoal, low glare, built for long sittings' },
]

export function SettingsView() {
  const { settings, updateSettings, setTheme, activePack, progress, resetProgress, replaceProgress } =
    useStore()

  const [confirmReset, setConfirmReset] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const answered = totalAnswered(progress)

  const download = () => {
    if (!activePack) return
    const blob = new Blob([exportProgress(progress)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${activePack.manifest.id}-progress.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="shell shell-narrow view">
      <header className="ref-head">
        <h1 className="t-h1">Settings</h1>
      </header>

      {/* ---- theme ---- */}
      <section className="ref-section">
        <h2 className="t-label">Appearance</h2>
        <div className="theme-choices">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              className={`theme-choice ${settings.theme === theme.value ? 'is-on' : ''}`}
              onClick={() => setTheme(theme.value)}
              aria-pressed={settings.theme === theme.value}
            >
              <span className="t-h3">{theme.label}</span>
              <span className="t-tiny t-dimmer">{theme.detail}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ---- behaviour ---- */}
      <section className="ref-section">
        <h2 className="t-label">During a session</h2>
        <div className="setting-rows">
          <label className="setting-row">
            <input
              type="checkbox"
              checked={settings.showTimer}
              onChange={(e) => updateSettings({ showTimer: e.target.checked })}
            />
            <span className="setting-row-body">
              <span className="t-h3">Show the session clock</span>
              <span className="t-tiny t-dimmer">
                A running count in the header. It never interrupts or gates anything.
              </span>
            </span>
          </label>

          <label className="setting-row">
            <input
              type="checkbox"
              checked={settings.keyboardShortcuts}
              onChange={(e) => updateSettings({ keyboardShortcuts: e.target.checked })}
            />
            <span className="setting-row-body">
              <span className="t-h3">Keyboard shortcuts</span>
              <span className="t-tiny t-dimmer">
                <span className="kbd">1</span>–<span className="kbd">9</span> pick an option ·{' '}
                <span className="kbd"><CornerDownLeft size={11} aria-hidden="true" /></span> check and advance · <span className="kbd">SPACE</span>{' '}
                reveal · <span className="kbd">F</span> flag · <span className="kbd">N</span> new
                numbers
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* ---- data ---- */}
      <section className="ref-section">
        <h2 className="t-label">Your progress</h2>

        <p className="prose t-small">
          Progress is stored in this browser only. It isn't uploaded anywhere, it isn't shared with
          anyone you send the app to, and clearing your browser data will remove it. Export it if
          you want a copy or want to carry it to another machine.
        </p>

        {activePack ? (
          <>
            <dl className="data-figures">
              <div>
                <dt className="t-label">Pack</dt>
                <dd className="t-small">{activePack.manifest.title}</dd>
              </div>
              <div>
                <dt className="t-label">Answered</dt>
                <dd className="t-mono t-small">{answered}</dd>
              </div>
              <div>
                <dt className="t-label">Sessions</dt>
                <dd className="t-mono t-small">{progress.sessions.length}</dd>
              </div>
              <div>
                <dt className="t-label">Time logged</dt>
                <dd className="t-mono t-small">{formatDuration(progress.totalMs)}</dd>
              </div>
            </dl>

            <div className="row gap-2 wrap">
              <button type="button" className="btn btn-outline" onClick={download}>
                Export progress
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => fileInput.current?.click()}
              >
                Import progress
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="visually-hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return

                  const parsed = parseProgressExport(await file.text())
                  if (!parsed) {
                    setImportNote("That file isn't an Overlearn progress export.")
                    return
                  }
                  if (parsed.packId !== activePack.manifest.id) {
                    setImportNote(
                      `That export is for pack "${parsed.packId}", but "${activePack.manifest.id}" is open. Open the matching pack first.`,
                    )
                    return
                  }
                  replaceProgress(parsed)
                  setImportNote('Progress imported.')
                }}
              />

              <span className="spacer" />

              {confirmReset ? (
                <>
                  <button
                    type="button"
                    className="btn btn-bad"
                    onClick={() => {
                      resetProgress(activePack.manifest.id)
                      setConfirmReset(false)
                    }}
                  >
                    Erase it all
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => setConfirmReset(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => setConfirmReset(true)}
                >
                  Reset this pack's progress
                </button>
              )}
            </div>

            {importNote && (
              <p className="notice notice-good" role="status">
                {importNote}
              </p>
            )}
          </>
        ) : (
          <p className="t-small t-dim">No pack is open.</p>
        )}
      </section>

      <section className="ref-section">
        <h2 className="t-label">About</h2>
        <p className="prose t-small">
          Overlearn is a generic study tool. It has no knowledge of any particular subject — it
          reads packs, which are generated from your own material by the <code>study-pack</code>{' '}
          skill. Add a new subject by generating a pack and loading it from the Packs screen.
        </p>
      </section>
    </div>
  )
}
