/**
 * The reference layer: topic and subtopic detail.
 *
 * This is where "knowing what's examinable" gets answered. Every subtopic
 * shows its recap, the formulas and definitions worth memorising, how much of
 * it you've covered, and — importantly — the citation back into the source
 * material, so anything that looks wrong can be checked against the slides
 * rather than taken on faith.
 */

import { ChevronRight } from 'lucide-react'
import type { Formula, KeyFact, Pack, Subtopic, Topic } from '../types/pack'
import { emphasisOf } from '../types/pack'
import { STATE_LABEL, masteryOf, topicQuestions, type PackProgress } from '../lib/progress'
import { paths, useNavigate } from '../lib/router'
import { useStore } from '../state/store'
import { Markish } from '../components/Markish'

/* ------------------------------------------------------------------ *
 * Topic
 * ------------------------------------------------------------------ */

export function TopicView({ pack, topicId }: { pack: Pack; topicId: string }) {
  const { progress } = useStore()
  const navigate = useNavigate()

  const topic = pack.topics.find((t) => t.id === topicId)
  if (!topic) return <NotFound label="topic" />

  const mastery = masteryOf(topicQuestions(topic), progress)
  const subtopicIds = topic.subtopics.map((s) => s.id)

  return (
    <div className="shell view">
      <Crumbs trail={[{ label: 'Coverage', to: paths.coverage() }]} current={topic.title} />

      <header className="ref-head">
        <div>
          <h1 className="t-h1">{topic.title}</h1>
          <p className="t-small t-dim">
            {topic.subtopics.length} subtopic{topic.subtopics.length === 1 ? '' : 's'} ·{' '}
            {mastery.total} question{mastery.total === 1 ? '' : 's'} ·{' '}
            <span className={`state-text state-text-${mastery.state}`}>
              {STATE_LABEL[mastery.state]}
            </span>
          </p>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate(paths.session('quiz', subtopicIds))}
        >
          Quiz this topic
        </button>
      </header>

      {topic.summary && <Markish className="prose ref-summary">{topic.summary}</Markish>}

      <FormulaBlock formulas={topic.formulas} />
      <FactBlock facts={topic.keyFacts} />

      <section className="ref-section">
        <h2 className="t-label">Subtopics</h2>
        <ul className="subtopic-list">
          {topic.subtopics.map((subtopic) => (
            <SubtopicRow key={subtopic.id} subtopic={subtopic} progress={progress} />
          ))}
        </ul>
      </section>
    </div>
  )
}

function SubtopicRow({ subtopic, progress }: { subtopic: Subtopic; progress: PackProgress }) {
  const navigate = useNavigate()
  const mastery = masteryOf(subtopic.questions, progress)

  return (
    <li>
      <button
        type="button"
        className="subtopic-row"
        onClick={() => navigate(paths.subtopic(subtopic.id))}
      >
        <span className={`state-dot state-${mastery.state}`} aria-hidden="true" />
        <span className="subtopic-row-body">
          <span className="row-baseline gap-2 wrap">
            <span className="t-h3">{subtopic.title}</span>
            {emphasisOf(subtopic) === 'core' && <span className="tile-core">core</span>}
          </span>
          {subtopic.summary && <span className="t-tiny t-dimmer subtopic-row-hint">{subtopic.summary}</span>}
        </span>
        <span className="spacer" />
        <span className="t-mono t-tiny t-dimmer">
          {mastery.seen}/{mastery.total}
        </span>
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ *
 * Subtopic
 * ------------------------------------------------------------------ */

export function SubtopicView({ pack, subtopicId }: { pack: Pack; subtopicId: string }) {
  const { progress } = useStore()
  const navigate = useNavigate()

  let found: { topic: Topic; subtopic: Subtopic } | null = null
  for (const topic of pack.topics) {
    const subtopic = topic.subtopics.find((s) => s.id === subtopicId)
    if (subtopic) {
      found = { topic, subtopic }
      break
    }
  }

  if (!found) return <NotFound label="subtopic" />

  const { topic, subtopic } = found
  const mastery = masteryOf(subtopic.questions, progress)
  const emphasis = emphasisOf(subtopic)

  const kinds = subtopic.questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.kind] = (acc[q.kind] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="shell view">
      <Crumbs
        trail={[
          { label: 'Coverage', to: paths.coverage() },
          { label: topic.title, to: paths.topic(topic.id) },
        ]}
        current={subtopic.title}
      />

      <header className="ref-head">
        <div>
          <div className="row-baseline gap-2 wrap">
            <h1 className="t-h1">{subtopic.title}</h1>
            {emphasis === 'core' && <span className="chip chip-accent">Core material</span>}
            {emphasis === 'background' && <span className="chip">Background</span>}
          </div>
          <p className="t-small t-dim">
            {mastery.total} question{mastery.total === 1 ? '' : 's'} ·{' '}
            <span className={`state-text state-text-${mastery.state}`}>
              {STATE_LABEL[mastery.state]}
            </span>
            {mastery.seen > 0 && <> · {Math.round(mastery.score * 100)}%</>}
          </p>
        </div>
        <span className="spacer" />
        <div className="row gap-2 wrap">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => navigate(paths.session('flashcards', [subtopic.id]))}
          >
            Flashcards
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(paths.session('quiz', [subtopic.id]))}
          >
            Quiz this
          </button>
        </div>
      </header>

      {subtopic.summary && <Markish className="prose ref-summary">{subtopic.summary}</Markish>}

      <FormulaBlock formulas={subtopic.formulas} />
      <FactBlock facts={subtopic.keyFacts} />

      <section className="ref-section">
        <h2 className="t-label">What you'll be asked</h2>
        <ul className="kind-list">
          {Object.entries(kinds).map(([kind, count]) => (
            <li key={kind} className="chip">
              {count} × {kind}
            </li>
          ))}
        </ul>
        <p className="t-tiny t-dimmer ref-note">
          Questions escalate as you go: recognition first, then supplying the answer, then
          producing it cold.
        </p>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Shared blocks
 * ------------------------------------------------------------------ */

export function FormulaBlock({ formulas }: { formulas?: Formula[] }) {
  if (!formulas || formulas.length === 0) return null

  return (
    <section className="ref-section">
      <h2 className="t-label">Formulas</h2>
      <ul className="formula-list">
        {formulas.map((formula, i) => (
          <li key={i} className="formula">
            <div className="formula-head">
              <span className="t-h3">{formula.name}</span>
              {formula.source && <span className="t-mono t-tiny t-dimmer">{formula.source}</span>}
            </div>
            <p className="formula-expr t-mono">{formula.expression}</p>
            {formula.note && <Markish className="prose t-small formula-note">{formula.note}</Markish>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function FactBlock({ facts }: { facts?: KeyFact[] }) {
  if (!facts || facts.length === 0) return null

  return (
    <section className="ref-section">
      <h2 className="t-label">Definitions</h2>
      <dl className="fact-list">
        {facts.map((fact, i) => (
          <div key={i} className="fact">
            <dt className="fact-term">
              {fact.term}
              {fact.source && <span className="t-mono t-tiny t-dimmer fact-source">{fact.source}</span>}
            </dt>
            <dd className="fact-def">
              <Markish>{fact.definition}</Markish>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function Crumbs({
  trail,
  current,
}: {
  trail: { label: string; to: string }[]
  current: string
}) {
  const navigate = useNavigate()
  return (
    <nav className="crumbs no-print" aria-label="Breadcrumb">
      {trail.map((crumb) => (
        <span key={crumb.to} className="crumb-group">
          <button type="button" className="crumb" onClick={() => navigate(crumb.to)}>
            {crumb.label}
          </button>
          <ChevronRight size={13} className="crumb-sep" aria-hidden="true" />
        </span>
      ))}
      <span className="crumb-current">{current}</span>
    </nav>
  )
}

function NotFound({ label }: { label: string }) {
  const navigate = useNavigate()
  return (
    <div className="shell shell-narrow view">
      <div className="panel empty">
        <h1 className="t-h2">That {label} isn't in this pack</h1>
        <p className="prose t-small">
          It may have been renamed or removed when the pack was regenerated.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => navigate(paths.coverage())}>
          Back to coverage
        </button>
      </div>
    </div>
  )
}
