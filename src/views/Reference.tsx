/**
 * The reference layer: topic and subtopic detail.
 *
 * This is where "knowing what's examinable" gets answered. Every subtopic
 * shows its recap, the formulas and definitions worth memorising, how much of
 * it you've covered, and — importantly — the citation back into the source
 * material, so anything that looks wrong can be checked against the slides
 * rather than taken on faith.
 */

import { useMemo } from 'react'
import { ChevronRight, Lock } from 'lucide-react'
import type { Formula, KeyFact, Pack, Subtopic, Topic } from '../types/pack'
import { emphasisOf } from '../types/pack'
import { STATE_LABEL, masteryOf, topicQuestions, type PackProgress } from '../lib/progress'
import { kindsAtTier, plannedCount, tierBreakdown, type TierSlice } from '../lib/scheduler'
import { paths, useNavigate } from '../lib/router'
import { useStore } from '../state/store'
import { Markish } from '../components/Markish'

/* ------------------------------------------------------------------ *
 * Tiers, described
 * ------------------------------------------------------------------ */

const TIER_TITLE: Record<1 | 2 | 3, string> = {
  1: 'Recognise',
  2: 'Supply',
  3: 'Produce',
}

const TIER_BLURB: Record<1 | 2 | 3, string> = {
  1: 'Pick the right answer from options.',
  2: 'Type or complete the answer with a prompt in front of you.',
  3: 'Produce it cold, with nothing to go on.',
}

/** What escalation is waiting for before it serves this tier by default. */
const TIER_UNLOCK: Record<1 | 2 | 3, string> = {
  1: 'Open from the start',
  2: 'Opens once tier 1 is landing (35%)',
  3: 'Opens once this subtopic is solid (70%)',
}

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
  const quizNow = plannedCount(pack, progress, { mode: 'quiz', subtopicIds })

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
          disabled={quizNow === 0}
          title={`${quizNow} of ${mastery.total} questions are open to a quiz right now`}
        >
          Quiz this topic
          <span className="btn-count t-mono">{quizNow}</span>
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
  const open = tierBreakdown(subtopic, progress)
    .filter((slice) => slice.unlocked)
    .reduce((n, slice) => n + slice.total, 0)

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
        <span
          className="t-mono t-tiny t-dimmer"
          title={`${mastery.seen} of ${mastery.total} seen · ${open} open to a quiz right now`}
        >
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

  // What a quiz would actually ask right now, rather than what the subtopic
  // contains. The two differ because escalation holds back the higher tiers,
  // and quoting the wrong one is what makes a quiz look broken.
  const quizNow = plannedCount(pack, progress, {
    mode: 'quiz',
    subtopicIds: [subtopic.id],
  })
  const cardsNow = plannedCount(pack, progress, {
    mode: 'flashcards',
    subtopicIds: [subtopic.id],
  })
  const tiers = tierBreakdown(subtopic, progress)
  const held = mastery.total - quizNow

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
            disabled={cardsNow === 0}
          >
            Flashcards
            <span className="btn-count t-mono">{cardsNow}</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(paths.session('quiz', [subtopic.id]))}
            disabled={quizNow === 0}
          >
            Quiz this
            <span className="btn-count t-mono">{quizNow}</span>
          </button>
        </div>
      </header>

      {subtopic.summary && <Markish className="prose ref-summary">{subtopic.summary}</Markish>}

      <FormulaBlock formulas={subtopic.formulas} />
      <FactBlock facts={subtopic.keyFacts} />

      <section className="ref-section">
        <div className="row-baseline gap-2 wrap">
          <h2 className="t-label">What you'll be asked</h2>
          <span className="spacer" />
          <span className="t-tiny t-dimmer">
            {quizNow} of {mastery.total} open to a quiz right now
          </span>
        </div>

        <ul className="tier-list">
          {tiers.map((slice) => (
            <TierRow key={slice.tier} subtopic={subtopic} slice={slice} />
          ))}
        </ul>

        <p className="t-tiny t-dimmer ref-note">
          {held > 0 ? (
            <>
              A quiz escalates: it serves the tiers this subtopic has unlocked, which is why it
              asks {quizNow} rather than all {mastery.total}. The other {held} open up as you
              land the earlier ones — or go straight at them with the drill buttons above, which
              ignore the ladder.
            </>
          ) : (
            <>
              Every tier is unlocked, so a quiz draws on all {mastery.total}. The drill buttons
              above narrow it to one tier at a time.
            </>
          )}
        </p>
      </section>
    </div>
  )
}

/**
 * One tier of a subtopic: what's written at it, how much you've seen, whether
 * escalation is serving it yet, and a way in regardless.
 *
 * The "regardless" is the point. Escalation decides the default path, but a
 * question you can see listed should never be unreachable — being told a
 * subtopic has forty questions and then handed twelve, with no way to find
 * the rest, reads as the app losing them.
 */
function TierRow({ subtopic, slice }: { subtopic: Subtopic; slice: TierSlice }) {
  const navigate = useNavigate()
  const kinds = useMemo(() => kindsAtTier(subtopic, slice.tier), [subtopic, slice.tier])

  if (slice.total === 0) return null

  return (
    <li className={`tier-row ${slice.unlocked ? 'is-open' : 'is-held'}`}>
      <span className="tier-rank t-mono" aria-hidden="true">
        {slice.tier}
      </span>

      <span className="tier-body">
        <span className="row-baseline gap-2 wrap">
          <span className="t-h3">{TIER_TITLE[slice.tier]}</span>
          <span className="t-tiny t-dimmer">{kinds.join(' · ')}</span>
          {!slice.unlocked && (
            <span className="chip tier-lock">
              <Lock size={11} aria-hidden="true" />
              Held back
            </span>
          )}
        </span>
        <span className="t-tiny t-dimmer">
          {TIER_BLURB[slice.tier]} {slice.unlocked ? '' : `${TIER_UNLOCK[slice.tier]}.`}
        </span>
      </span>

      <span className="spacer" />

      <span className="tier-counts">
        <span className="t-mono t-tiny t-dimmer" title="Seen at least once, of the total">
          {slice.seen}/{slice.total}
        </span>
        {slice.failing > 0 && (
          <span className="t-mono t-tiny tile-failing" title="Sitting on a wrong answer">
            {slice.failing} wrong
          </span>
        )}
      </span>

      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => navigate(paths.session('quiz', [subtopic.id], [slice.tier]))}
        title={
          slice.unlocked
            ? `Drill the ${slice.total} tier ${slice.tier} questions`
            : `Skip the ladder and drill these ${slice.total} now`
        }
      >
        {slice.unlocked ? 'Drill' : 'Drill anyway'}
        <span className="btn-count t-mono">{slice.total}</span>
      </button>
    </li>
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
