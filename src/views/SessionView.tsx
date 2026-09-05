/**
 * The session runner.
 *
 * Owns the queue, the per-question phase, and what happens when you get one
 * wrong. Every mode routes through here; they differ only in how the queue
 * was built (see lib/scheduler) and whether feedback is shown immediately or
 * held until the end.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Pack } from '../types/pack'
import { instantiate, type QuestionInstance } from '../lib/instance'
import { mark, type Marking, type Response } from '../lib/grading'
import {
  MODE_LABEL,
  buildQueue,
  defaultLimit,
  requeue,
  type QueueItem,
  type SessionMode,
  type SessionSpec,
} from '../lib/scheduler'
import { paths, useNavigate } from '../lib/router'
import { useStore } from '../state/store'
import { QuestionCard } from '../components/QuestionCard'
import { formatDuration } from '../components/AppHeader'
import { Markish } from '../components/Markish'

interface LogEntry {
  item: QueueItem
  instance: QuestionInstance
  marking: Marking
}

const MOCK_MINUTES = 30

export function SessionView({ pack, mode, scope }: { pack: Pack; mode: string; scope: string[] }) {
  const { progress, settings, answer, flag, finishSession } = useStore()
  const navigate = useNavigate()

  const sessionMode: SessionMode = isMode(mode) ? mode : 'quiz'
  const isMock = sessionMode === 'mock'

  /* -- queue, built once when the session starts ---------------------- */

  // Built from a snapshot of progress deliberately: rebuilding as you answer
  // would shuffle the queue under your feet mid-session.
  const startedAt = useRef(Date.now())
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [current, setCurrent] = useState<QueueItem | null>(null)
  const [instance, setInstance] = useState<QuestionInstance | null>(null)
  const [phase, setPhase] = useState<'answering' | 'revealed'>('answering')
  const [marking, setMarking] = useState<Marking | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [done, setDone] = useState(false)
  const [plannedTotal, setPlannedTotal] = useState(0)

  useEffect(() => {
    const spec: SessionSpec = {
      mode: sessionMode,
      subtopicIds: scope,
      limit: defaultLimit(sessionMode, 999),
    }
    const built = buildQueue(pack, progress, spec)
    const [first, ...rest] = built

    startedAt.current = Date.now()
    setPlannedTotal(built.length)
    setQueue(rest)
    setCurrent(first ?? null)
    setInstance(first ? instantiate(first.question) : null)
    setPhase('answering')
    setMarking(null)
    setLog([])
    setDone(built.length === 0)
    // Rebuilding on every progress change would reshuffle mid-session, so
    // progress is read once at the start and left out of the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, sessionMode, scope.join(',')])

  /* -- mock timer ----------------------------------------------------- */

  const [remainingMs, setRemainingMs] = useState(MOCK_MINUTES * 60_000)

  useEffect(() => {
    if (!isMock || done) return
    const id = window.setInterval(() => {
      const left = MOCK_MINUTES * 60_000 - (Date.now() - startedAt.current)
      setRemainingMs(left)
      if (left <= 0) setDone(true)
    }, 500)
    return () => window.clearInterval(id)
  }, [isMock, done])

  /* -- finishing ------------------------------------------------------ */

  const finished = useRef(false)
  useEffect(() => {
    if (!done || finished.current) return
    finished.current = true

    const correct = log.filter((e) => e.marking.verdict === 'correct').length
    finishSession({
      id: `${sessionMode}-${startedAt.current}`,
      mode: sessionMode,
      startedAt: startedAt.current,
      endedAt: Date.now(),
      answered: log.length,
      correct,
      subtopicIds: [...new Set(log.map((e) => e.item.subtopicId))],
      score: isMock
        ? { correct, total: log.length, durationMs: Date.now() - startedAt.current }
        : undefined,
    })
  }, [done, log, sessionMode, isMock, finishSession])

  // A new session in the same mode needs the guard released.
  useEffect(() => {
    finished.current = false
  }, [sessionMode, scope.join(',')])

  /* -- actions -------------------------------------------------------- */

  const handleSubmit = useCallback(
    (response: Response) => {
      if (!current || !instance) return

      const result = mark(instance, response)
      setMarking(result)
      setPhase('revealed')
      setLog((prev) => [...prev, { item: current, instance, marking: result }])
      answer(current.question.id, result.verdict)
    },
    [current, instance, answer],
  )

  const handleNext = useCallback(() => {
    if (!current) return

    // A missed question comes back later in this same sitting. In a mock it
    // does not — a real test doesn't give you a second go.
    const nextQueue = isMock
      ? queue
      : requeue(queue, current, marking?.verdict ?? 'wrong')

    const [next, ...rest] = nextQueue

    if (!next) {
      setDone(true)
      setCurrent(null)
      setInstance(null)
      return
    }

    setQueue(rest)
    setCurrent(next)
    setInstance(instantiate(next.question, next.attempt))
    setPhase('answering')
    setMarking(null)
  }, [current, queue, marking, isMock])

  const handleReroll = useCallback(() => {
    if (!current) return
    setInstance(instantiate(current.question, Date.now()))
  }, [current])

  const handleFlag = useCallback(() => {
    if (current) flag(current.question.id)
  }, [current, flag])

  /* -- render --------------------------------------------------------- */

  if (done) {
    return (
      <SessionSummary
        pack={pack}
        mode={sessionMode}
        log={log}
        durationMs={Date.now() - startedAt.current}
        onRestart={() => {
          finished.current = false
          navigate(paths.session(sessionMode, scope))
        }}
      />
    )
  }

  if (!current || !instance) {
    return (
      <div className="shell shell-narrow view">
        <div className="panel empty">
          <h1 className="t-h2">Nothing to ask yet</h1>
          <p className="prose t-small">
            This mode has no questions in the selected scope. Try another mode, or widen the
            selection from the coverage map.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => navigate(paths.coverage())}>
            Back to coverage
          </button>
        </div>
      </div>
    )
  }

  const answered = log.length
  const total = Math.max(plannedTotal, answered + queue.length + 1)
  const flagged = progress.questions[current.question.id]?.flagged ?? false
  const isLast = queue.length === 0

  return (
    <div className="shell shell-narrow view session">
      <div className="session-bar no-print">
        <div className="session-bar-top">
          <span className="chip chip-accent">{MODE_LABEL[sessionMode]}</span>
          <span className="t-small t-dim session-where">
            {current.topicTitle}
            <span className="t-dimmer"> · </span>
            {current.subtopicTitle}
          </span>
          <span className="spacer" />
          {isMock ? (
            <span
              className={`t-mono t-small session-clock ${remainingMs < 120_000 ? 'is-low' : ''}`}
              title="Time remaining"
            >
              {formatDuration(Math.max(0, remainingMs))}
            </span>
          ) : (
            <span className="t-mono t-small t-dimmer">
              {answered} answered
            </span>
          )}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setDone(true)}
            title="End this session and see the summary"
          >
            End
          </button>
        </div>

        <div className="session-progress" role="progressbar" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={total}>
          <span
            className="session-progress-fill"
            style={{ width: `${Math.min(100, (answered / Math.max(1, total)) * 100)}%` }}
          />
        </div>
      </div>

      <QuestionCard
        key={`${current.question.id}:${current.attempt}:${instance.seed}`}
        instance={instance}
        phase={phase}
        marking={marking}
        suppressFeedback={isMock}
        flagged={flagged}
        keyboard={settings.keyboardShortcuts}
        onSubmit={handleSubmit}
        onNext={handleNext}
        onFlag={handleFlag}
        onReroll={handleReroll}
        nextLabel={isLast ? 'Finish' : 'Next'}
      />

      {current.attempt > 0 && phase === 'answering' && (
        <p className="t-tiny t-dimmer session-repeat">
          Back again — you missed this one earlier in the session.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

function SessionSummary({
  pack,
  mode,
  log,
  durationMs,
  onRestart,
}: {
  pack: Pack
  mode: SessionMode
  log: LogEntry[]
  durationMs: number
  onRestart: () => void
}) {
  const navigate = useNavigate()

  const correct = log.filter((e) => e.marking.verdict === 'correct').length
  const partial = log.filter((e) => e.marking.verdict === 'partial').length
  const wrong = log.filter((e) => e.marking.verdict === 'wrong').length
  const pct = log.length > 0 ? Math.round((correct / log.length) * 100) : 0

  const bySubtopic = useMemo(() => {
    const map = new Map<string, { title: string; correct: number; total: number }>()
    for (const entry of log) {
      const key = entry.item.subtopicId
      const row = map.get(key) ?? { title: entry.item.subtopicTitle, correct: 0, total: 0 }
      row.total += 1
      if (entry.marking.verdict === 'correct') row.correct += 1
      map.set(key, row)
    }
    return [...map.entries()]
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => a.correct / a.total - b.correct / b.total)
  }, [log])

  const missed = log.filter((e) => e.marking.verdict !== 'correct')

  if (log.length === 0) {
    return (
      <div className="shell shell-narrow view">
        <div className="panel empty">
          <h1 className="t-h2">Session ended</h1>
          <p className="prose t-small">Nothing was answered, so there's nothing to report.</p>
          <div className="row gap-2 wrap">
            <button type="button" className="btn btn-primary" onClick={() => navigate(paths.coverage())}>
              Back to coverage
            </button>
            <button type="button" className="btn btn-outline" onClick={onRestart}>
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell shell-narrow view">
      <section className="summary">
        <header className="summary-head">
          <span className="chip chip-accent">{MODE_LABEL[mode]}</span>
          <h1 className="t-h1">
            {correct} of {log.length} right
          </h1>
          <p className="t-small t-dim">
            {pct}% · {formatDuration(durationMs)} · {pack.manifest.title}
          </p>
        </header>

        <div className="summary-bars">
          <SummaryBar label="Right" value={correct} total={log.length} tone="good" />
          {partial > 0 && <SummaryBar label="Partly" value={partial} total={log.length} tone="warn" />}
          <SummaryBar label="Wrong" value={wrong} total={log.length} tone="bad" />
        </div>

        {bySubtopic.length > 1 && (
          <section className="summary-section">
            <h2 className="t-label">By subtopic, weakest first</h2>
            <ul className="summary-list">
              {bySubtopic.map((row) => {
                const rowPct = Math.round((row.correct / row.total) * 100)
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="summary-row"
                      onClick={() => navigate(paths.subtopic(row.id))}
                    >
                      <span className="summary-row-name t-small">{row.title}</span>
                      <span className="spacer" />
                      <span className="summary-row-bar" aria-hidden="true">
                        <span
                          className={`summary-row-fill ${rowPct >= 70 ? 'tone-good' : rowPct >= 40 ? 'tone-warn' : 'tone-bad'}`}
                          style={{ width: `${Math.max(3, rowPct)}%` }}
                        />
                      </span>
                      <span className="t-mono t-tiny t-dimmer summary-row-score">
                        {row.correct}/{row.total}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {missed.length > 0 && (
          <section className="summary-section">
            <h2 className="t-label">What you missed</h2>
            <ul className="missed-list">
              {missed.map((entry, i) => (
                <li key={`${entry.item.question.id}-${i}`} className="missed">
                  <p className="missed-prompt">{entry.instance.prompt}</p>
                  <p className="missed-answer">
                    <span className="t-label">Answer</span>
                    <span>{entry.instance.displayAnswer}</span>
                  </p>
                  {entry.instance.explanation && (
                    <Markish className="prose t-small">{entry.instance.explanation}</Markish>
                  )}
                  {entry.item.question.source && (
                    <p className="t-mono t-tiny t-dimmer">{entry.item.question.source}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="summary-foot">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate(paths.coverage())}>
            Back to coverage
          </button>
          <button type="button" className="btn btn-outline" onClick={onRestart}>
            Another round
          </button>
          {missed.length > 0 && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => navigate(paths.session('mistakes'))}
            >
              Drill what I missed
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function SummaryBar({
  label,
  value,
  total,
  tone,
}: {
  label: string
  value: number
  total: number
  tone: 'good' | 'warn' | 'bad'
}) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="summary-bar">
      <span className="t-label">{label}</span>
      <span className="summary-bar-track" aria-hidden="true">
        <span className={`summary-bar-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="t-mono t-small">{value}</span>
    </div>
  )
}

function isMode(value: string): value is SessionMode {
  return ['quiz', 'flashcards', 'rapidfire', 'mock', 'mistakes'].includes(value)
}
