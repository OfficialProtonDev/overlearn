/**
 * The library: what's loaded, and how to load more.
 *
 * This is the "point it at a folder" screen. Three routes in, because no
 * single one works in every browser — a directory picker where it exists,
 * a folder input everywhere else, and drag-and-drop for both. Whatever comes
 * back, the failures are reported precisely: a pack that won't load names the
 * file and the field, because the usual cause is a generation bug worth
 * fixing rather than a mystery to shrug at.
 */

import { useCallback, useRef, useState } from 'react'
import type { Pack } from '../types/pack'
import {
  openPackFromDirectoryPicker,
  openPackFromDrop,
  openPackFromFileList,
  supportsDirectoryPicker,
  exportPack,
  type LoadReport,
} from '../lib/packLoader'
import { packQuestions } from '../lib/progress'
import { paths, useNavigate } from '../lib/router'
import { useStore } from '../state/store'
import { hasErrors, type Issue } from '../lib/validate'

export function Library() {
  const { packs, activePack, selectPack, addPack, removePack } = useStore()
  const navigate = useNavigate()

  const [issues, setIssues] = useState<Issue[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)

  const consume = useCallback(
    async (report: LoadReport | null) => {
      if (!report) return
      setIssues(report.issues)

      if (report.pack) {
        await addPack(report.pack)
        const s = report.summary
        setNotice(
          s
            ? `Loaded ${report.pack.manifest.title} — ${s.topics} topics, ${s.subtopics} subtopics, ${s.questions} questions.`
            : `Loaded ${report.pack.manifest.title}.`,
        )
        navigate(paths.coverage())
      } else {
        setNotice(null)
      }
    },
    [addPack, navigate],
  )

  const pickDirectory = async () => {
    setBusy(true)
    try {
      await consume(await openPackFromDirectoryPicker())
    } finally {
      setBusy(false)
    }
  }

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    setBusy(true)
    try {
      await consume(await openPackFromDrop(event.dataTransfer))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell view">
      <header className="lib-head">
        <h1 className="t-h1">Study packs</h1>
        <p className="prose t-small">
          A pack is a folder holding <code>pack.json</code> and a <code>topics/</code> directory.
          Generate one with the <code>study-pack</code> skill, then load it here. Packs stay in this
          browser; nothing is uploaded.
        </p>
      </header>

      {/* ---- loading ---- */}
      <section
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="dropzone-body">
          <p className="t-h2">Drop a pack folder here</p>
          <p className="t-small t-dim">or</p>
          <div className="row gap-2 wrap dropzone-actions">
            {supportsDirectoryPicker() && (
              <button type="button" className="btn btn-primary" onClick={pickDirectory} disabled={busy}>
                Choose a folder
              </button>
            )}
            <button
              type="button"
              className={supportsDirectoryPicker() ? 'btn btn-outline' : 'btn btn-primary'}
              onClick={() => folderInput.current?.click()}
              disabled={busy}
            >
              Browse for a folder
            </button>
          </div>
          <input
            ref={folderInput}
            type="file"
            className="visually-hidden"
            /* webkitdirectory is non-standard but is how every current browser
               exposes folder selection from a file input. */
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            multiple
            onChange={async (e) => {
              const files = e.target.files
              if (!files || files.length === 0) return
              setBusy(true)
              try {
                await consume(await openPackFromFileList(files))
              } finally {
                setBusy(false)
                e.target.value = ''
              }
            }}
          />
        </div>
      </section>

      {notice && (
        <p className="notice notice-good" role="status">
          {notice}
        </p>
      )}

      {issues.length > 0 && <IssueReport issues={issues} onDismiss={() => setIssues([])} />}

      {/* ---- what's loaded ---- */}
      <section className="ref-section">
        <h2 className="t-label">Loaded packs</h2>

        {packs.length === 0 ? (
          <div className="panel empty">
            <p className="t-h3">Nothing loaded yet</p>
            <p className="prose t-small">
              Once you've generated a pack, load it above and it'll stay here between visits.
            </p>
          </div>
        ) : (
          <ul className="pack-list">
            {packs.map((pack) => (
              <PackRow
                key={pack.manifest.id}
                pack={pack}
                active={activePack?.manifest.id === pack.manifest.id}
                onOpen={() => {
                  selectPack(pack.manifest.id)
                  navigate(paths.coverage())
                }}
                onRemove={() => void removePack(pack.manifest.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function PackRow({
  pack,
  active,
  onOpen,
  onRemove,
}: {
  pack: Pack
  active: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const questions = packQuestions(pack).length
  const subtopics = pack.topics.reduce((n, t) => n + t.subtopics.length, 0)

  const originLabel =
    pack.origin.kind === 'bundled'
      ? 'Shipped with the app'
      : pack.origin.kind === 'folder'
        ? `From folder “${pack.origin.name}”`
        : `From file “${pack.origin.name}”`

  const download = () => {
    const blob = new Blob([exportPack(pack)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${pack.manifest.id}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <li className={`pack-row ${active ? 'is-active' : ''}`}>
      <button type="button" className="pack-open" onClick={onOpen}>
        <span className="pack-title">
          <span className="t-h2">{pack.manifest.title}</span>
          {active && <span className="chip chip-accent">Open</span>}
        </span>
        {pack.manifest.subtitle && <span className="t-small t-dim">{pack.manifest.subtitle}</span>}
        <span className="t-tiny t-dimmer">
          {pack.topics.length} topics · {subtopics} subtopics · {questions} questions
        </span>
        <span className="t-tiny t-dimmer">{originLabel}</span>
      </button>

      <div className="pack-actions no-print">
        <button type="button" className="btn btn-quiet btn-sm" onClick={download}>
          Export
        </button>
        {pack.origin.kind !== 'bundled' &&
          (confirming ? (
            <>
              <button type="button" className="btn btn-bad btn-sm" onClick={onRemove}>
                Remove for good
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setConfirming(true)}
              title="Remove this pack from the browser. Your progress is kept."
            >
              Remove
            </button>
          ))}
      </div>
    </li>
  )
}

function IssueReport({ issues, onDismiss }: { issues: Issue[]; onDismiss: () => void }) {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const blocked = hasErrors(issues)

  return (
    <section className={`issues ${blocked ? 'issues-error' : 'issues-warn'}`}>
      <header className="issues-head">
        <h2 className="t-h3">
          {blocked
            ? `This pack couldn't be loaded — ${errors.length} problem${errors.length === 1 ? '' : 's'}`
            : `Loaded, with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
        </h2>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </header>

      <ul className="issue-list">
        {[...errors, ...warnings].slice(0, 40).map((issue, i) => (
          <li key={i} className={`issue issue-${issue.severity}`}>
            <span className="t-mono t-tiny issue-path">{issue.path}</span>
            <span className="t-small issue-message">{issue.message}</span>
          </li>
        ))}
      </ul>

      {issues.length > 40 && (
        <p className="t-tiny t-dimmer">…and {issues.length - 40} more.</p>
      )}
    </section>
  )
}
