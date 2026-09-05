/**
 * The coverage map — what opens first.
 *
 * The organising idea is that a blind spot is more expensive than a weak
 * spot. Untouched material is drawn as an outline rather than a filled tile,
 * so what you haven't looked at reads differently from what you've looked at
 * and struggled with, at a glance and from across the desk.
 */

import { useMemo } from 'react'
import {
  Layers,
  ListChecks,
  RotateCcw,
  Timer,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Pack, Subtopic, Topic } from '../types/pack'
import { emphasisOf } from '../types/pack'
import {
  masteryOf,
  mistakeQuestions,
  packQuestions,
  subtopicStats,
  topicQuestions,
  totalAnswered,
  weakestFirst,
  STATE_LABEL,
  type Mastery,
  type PackProgress,
} from '../lib/progress'
import { paths, useNavigate } from '../lib/router'
import { useStore } from '../state/store'
import { Markish } from '../components/Markish'
import { formatDuration } from '../components/AppHeader'

export function Coverage({ pack }: { pack: Pack }) {
  const { progress } = useStore()
  const navigate = useNavigate()

  const stats = useMemo(() => subtopicStats(pack, progress), [pack, progress])
  const weakest = useMemo(() => weakestFirst(stats).slice(0, 4), [stats])
  const mistakes = useMemo(() => mistakeQuestions(pack, progress), [pack, progress])

  const allQuestions = packQuestions(pack)
  const overall = masteryOf(allQuestions, progress)
  const answered = totalAnswered(progress)

  const untouched = stats.filter((s) => s.mastery.state === 'untouched').length
  const weakCount = stats.filter((s) => s.mastery.state === 'weak').length

  return (
    <div className="shell shell-wide view">
      {/* ---- pack identity + overall state ---- */}
      <section className="cover-hero">
        <div className="cover-hero-text">
          <h1 className="t-h1">{pack.manifest.title}</h1>
          {pack.manifest.subtitle && <p className="cover-subtitle">{pack.manifest.subtitle}</p>}
          {pack.manifest.description && (
            <Markish className="prose t-small cover-description">{pack.manifest.description}</Markish>
          )}
        </div>

        <dl className="cover-figures">
          <div>
            <dt className="t-label">Overall</dt>
            <dd className="cover-figure t-mono">{Math.round(overall.score * 100)}%</dd>
          </div>
          <div>
            <dt className="t-label">Answered</dt>
            <dd className="cover-figure t-mono">
              {answered}
              <span className="cover-figure-of">/{allQuestions.length}</span>
            </dd>
          </div>
          <div>
            <dt className="t-label">Not started</dt>
            <dd className="cover-figure t-mono">{untouched}</dd>
          </div>
          <div>
            <dt className="t-label">Time logged</dt>
            <dd className="cover-figure t-mono">{formatDuration(progress.totalMs)}</dd>
          </div>
        </dl>
      </section>

      {/* ---- how to start ---- */}
      <section className="cover-modes">
        <ModeCard
          icon={ListChecks}
          title="Quiz"
          detail={
            untouched > 0 || weakCount > 0
              ? `Escalating, weakest first — ${untouched + weakCount} subtopic${untouched + weakCount === 1 ? '' : 's'} need attention`
              : 'Escalating across everything in the pack'
          }
          primary
          onStart={() => navigate(paths.session('quiz'))}
        />
        <ModeCard
          icon={Layers}
          title="Flashcards"
          detail="Cold recall, graded by you"
          onStart={() => navigate(paths.session('flashcards'))}
        />
        <ModeCard
          icon={Zap}
          title="Rapid fire"
          detail="Recognition only — find gaps fast"
          onStart={() => navigate(paths.session('rapidfire'))}
        />
        <ModeCard
          icon={Timer}
          title="Mock test"
          detail="Timed, mixed, no feedback until the end"
          onStart={() => navigate(paths.session('mock'))}
        />
        <ModeCard
          icon={RotateCcw}
          title="Mistake review"
          detail={
            mistakes.length === 0
              ? 'Nothing wrong or flagged yet'
              : `${mistakes.length} question${mistakes.length === 1 ? '' : 's'} to clear`
          }
          disabled={mistakes.length === 0}
          onStart={() => navigate(paths.session('mistakes'))}
        />
      </section>

      {/* ---- what to do next ---- */}
      {weakest.length > 0 && answered > 0 && (
        <section className="cover-section">
          <div className="cover-section-head">
            <h2 className="t-h2">Needs the most work</h2>
            <p className="t-small t-dim">Ordered by blind spots first, then by how shaky it is.</p>
          </div>
          <ul className="focus-list">
            {weakest.map(({ topic, subtopic, mastery }) => (
              <li key={subtopic.id}>
                <button
                  type="button"
                  className="focus-row"
                  onClick={() => navigate(paths.subtopic(subtopic.id))}
                >
                  <span className={`state-dot state-${mastery.state}`} aria-hidden="true" />
                  <span className="focus-name">
                    <span className="t-h3">{subtopic.title}</span>
                    <span className="t-tiny t-dimmer">{topic.title}</span>
                  </span>
                  <span className="spacer" />
                  <span className="t-tiny t-dim focus-state">{STATE_LABEL[mastery.state]}</span>
                  <span className="t-mono t-tiny t-dimmer">
                    {mastery.seen}/{mastery.total}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- the map itself ---- */}
      <section className="cover-section">
        <div className="cover-section-head">
          <h2 className="t-h2">Coverage</h2>
          <Legend />
        </div>

        <div className="topic-stack">
          {pack.topics.map((topic) => (
            <TopicBlock key={topic.id} topic={topic} progress={progress} />
          ))}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function ModeCard({
  icon: Icon,
  title,
  detail,
  onStart,
  primary,
  disabled,
}: {
  icon: LucideIcon
  title: string
  detail: string
  onStart: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`mode-card ${primary ? 'mode-card-primary' : ''}`}
      onClick={onStart}
      disabled={disabled}
    >
      <span className="mode-card-title">
        <Icon size={16} aria-hidden="true" strokeWidth={1.9} />
        <span className="t-h3">{title}</span>
      </span>
      <span className="t-tiny t-dim mode-card-detail">{detail}</span>
    </button>
  )
}

function Legend() {
  return (
    <ul className="legend" aria-label="Coverage key">
      {(['untouched', 'weak', 'shaky', 'strong'] as const).map((state) => (
        <li key={state}>
          <span className={`state-dot state-${state}`} aria-hidden="true" />
          <span className="t-tiny t-dim">{STATE_LABEL[state]}</span>
        </li>
      ))}
    </ul>
  )
}

function TopicBlock({ topic, progress }: { topic: Topic; progress: PackProgress }) {
  const navigate = useNavigate()
  const mastery = masteryOf(topicQuestions(topic), progress)

  return (
    <section className="topic-block">
      <header className="topic-head">
        <button
          type="button"
          className="topic-title"
          onClick={() => navigate(paths.topic(topic.id))}
        >
          <h3 className="t-h2">{topic.title}</h3>
        </button>
        <span className="spacer" />
        <span className="t-tiny t-dimmer t-mono">
          {mastery.seen}/{mastery.total}
        </span>
        <TopicBar mastery={mastery} />
      </header>

      <div className="tile-grid">
        {topic.subtopics.map((subtopic) => (
          <SubtopicTile key={subtopic.id} subtopic={subtopic} progress={progress} />
        ))}
      </div>
    </section>
  )
}

function TopicBar({ mastery }: { mastery: Mastery }) {
  return (
    <span
      className="topic-bar"
      title={`${Math.round(mastery.score * 100)}% across this topic`}
      aria-hidden="true"
    >
      <span
        className={`topic-bar-fill state-fill-${mastery.state}`}
        style={{ width: `${Math.max(2, mastery.score * 100)}%` }}
      />
    </span>
  )
}

function SubtopicTile({ subtopic, progress }: { subtopic: Subtopic; progress: PackProgress }) {
  const navigate = useNavigate()
  const mastery = masteryOf(subtopic.questions, progress)
  const emphasis = emphasisOf(subtopic)

  return (
    <button
      type="button"
      className={`tile tile-${mastery.state}`}
      onClick={() => navigate(paths.subtopic(subtopic.id))}
      title={`${subtopic.title} — ${STATE_LABEL[mastery.state]}, ${mastery.seen} of ${mastery.total} seen`}
    >
      <span className="tile-top">
        <span className="tile-name">{subtopic.title}</span>
        {emphasis === 'core' && <span className="tile-core" title="Marked as core material">core</span>}
      </span>

      <span className="tile-bar" aria-hidden="true">
        <span
          className={`tile-bar-fill state-fill-${mastery.state}`}
          style={{ width: `${Math.max(mastery.state === 'untouched' ? 0 : 4, mastery.score * 100)}%` }}
        />
      </span>

      <span className="tile-foot">
        <span className="t-tiny t-dimmer t-mono">
          {mastery.seen}/{mastery.total}
        </span>
        {mastery.failing > 0 && (
          <span className="tile-failing t-tiny t-mono" title="Currently sitting on a wrong answer">
            {mastery.failing} wrong
          </span>
        )}
      </span>
    </button>
  )
}
