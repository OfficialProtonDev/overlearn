/**
 * One question, in whichever of the six forms it takes.
 *
 * The card owns the response being composed and hands it up on submit; it
 * does not know about queues, scoring or progress. That keeps the six kinds
 * in one readable place and lets the mock test reuse it with feedback
 * suppressed.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsDown, Check, CornerDownLeft, Dice5, Eye, Lightbulb, Star, X } from 'lucide-react'
import type { Question } from '../types/pack'
import { tierOf } from '../types/pack'
import type { QuestionInstance } from '../lib/instance'
import { isTemplated } from '../lib/instance'
import type { Marking, Response, Verdict } from '../lib/grading'
import { hintFor, type AssistLevel } from '../lib/assist'
import { MarkishLine, Markish } from './Markish'

const KIND_LABEL: Record<Question['kind'], string> = {
  mcq: 'Multiple choice',
  multi: 'Select all that apply',
  short: 'Short answer',
  recall: 'Recall',
  cloze: 'Fill the blanks',
  computation: 'Computation',
}

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: 'Recognise',
  2: 'Supply',
  3: 'Produce',
}

interface QuestionCardProps {
  instance: QuestionInstance
  /** 'answering' collects a response; 'revealed' shows the outcome. */
  phase: 'answering' | 'revealed'
  marking: Marking | null
  /** Mock tests collect answers without showing whether they were right. */
  suppressFeedback?: boolean
  flagged: boolean
  keyboard: boolean
  /** How much help has been taken on this question already. */
  assist: AssistLevel
  /** True when there is an easier question on this material to fall back to. */
  canStepDown: boolean
  onSubmit: (response: Response) => void
  onNext: () => void
  onFlag: () => void
  onReroll: () => void
  onHint: () => void
  onStepDown: () => void
  /** Label for the advance button, e.g. "Next" or "Finish". */
  nextLabel: string
}

export function QuestionCard({
  instance,
  phase,
  marking,
  suppressFeedback = false,
  flagged,
  keyboard,
  assist,
  canStepDown,
  onSubmit,
  onNext,
  onFlag,
  onReroll,
  onHint,
  onStepDown,
  nextLabel,
}: QuestionCardProps) {
  const q = instance.question

  /* -- response state, reset whenever the instance changes ------------ */
  const instanceKey = `${q.id}:${instance.seed}`

  const [chosen, setChosen] = useState<number | null>(null)
  const [chosenMulti, setChosenMulti] = useState<number[]>([])
  const [text, setText] = useState('')
  const [blanks, setBlanks] = useState<string[]>([])
  const [flipped, setFlipped] = useState(false)
  const [stepsShown, setStepsShown] = useState(0)

  const firstInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setChosen(null)
    setChosenMulti([])
    setText('')
    setBlanks([])
    setFlipped(false)
    setStepsShown(0)
    // Focus the entry field so a typed answer needs no click first.
    const id = window.setTimeout(() => firstInput.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [instanceKey])

  /* -- submitting ----------------------------------------------------- */

  const canSubmit = useMemo(() => {
    switch (q.kind) {
      case 'mcq':
        return chosen !== null
      case 'multi':
        return chosenMulti.length > 0
      case 'short':
      case 'computation':
        return text.trim().length > 0
      case 'cloze':
        return blanks.some((b) => (b ?? '').trim().length > 0)
      case 'recall':
        return flipped
    }
  }, [q.kind, chosen, chosenMulti, text, blanks, flipped])

  const submit = () => {
    if (phase !== 'answering') return
    switch (q.kind) {
      case 'mcq':
        if (chosen !== null) onSubmit({ kind: 'mcq', chosen })
        break
      case 'multi':
        if (chosenMulti.length > 0)
          onSubmit({ kind: 'multi', chosen: [...chosenMulti].sort((a, b) => a - b) })
        break
      case 'short':
        if (text.trim()) onSubmit({ kind: 'short', text })
        break
      case 'computation':
        if (text.trim()) onSubmit({ kind: 'computation', text })
        break
      case 'cloze':
        onSubmit({ kind: 'cloze', text: q.blanks.map((_, i) => blanks[i] ?? '') })
        break
      case 'recall':
        break // graded by the buttons below
    }
  }

  const selfGrade = (verdict: Verdict) => onSubmit({ kind: 'recall', selfVerdict: verdict })

  /* -- getting unstuck ------------------------------------------------ */

  // Getting unstuck is offered on the forms that can strand you: anything you
  // have to type or produce. Multiple choice already gives you somewhere to
  // start, and a mock test is meant to be uncomfortable.
  const strandable = q.kind !== 'mcq' && q.kind !== 'multi'
  const hint = strandable ? hintFor(q) : null
  const offerHelp = phase === 'answering' && !suppressFeedback && strandable
  const canHint = offerHelp && hint !== null && assist < 1
  const canDrop = offerHelp && canStepDown

  /* -- keyboard ------------------------------------------------------- */

  useEffect(() => {
    if (!keyboard) return

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true

      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Enter') {
        event.preventDefault()
        if (phase === 'revealed') onNext()
        else if (q.kind === 'recall' && !flipped) setFlipped(true)
        else submit()
        return
      }

      if (typing) return

      if (event.key === ' ') {
        event.preventDefault()
        if (phase === 'revealed') onNext()
        else if (q.kind === 'recall' && !flipped) setFlipped(true)
        else if (q.kind === 'computation' && stepsShown < instance.steps.length)
          setStepsShown((n) => n + 1)
        return
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        onFlag()
        return
      }

      if (event.key.toLowerCase() === 'n' && isTemplated(q) && phase === 'answering') {
        event.preventDefault()
        onReroll()
        return
      }

      if (event.key.toLowerCase() === 'h' && canHint) {
        event.preventDefault()
        onHint()
        return
      }

      if (event.key.toLowerCase() === 'e' && canDrop) {
        event.preventDefault()
        onStepDown()
        return
      }

      if (phase === 'answering' && /^[1-9]$/.test(event.key)) {
        // Keys address what's on screen, so map the position back through the
        // shuffle before recording a choice.
        const position = Number(event.key) - 1
        const index = instance.optionMap[position]
        if (index !== undefined && (q.kind === 'mcq' || q.kind === 'multi')) {
          event.preventDefault()
          if (q.kind === 'mcq') setChosen(index)
          else
            setChosenMulti((prev) =>
              prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
            )
        }
      }

      if (phase === 'revealed' && q.kind === 'recall') {
        if (event.key.toLowerCase() === 'j') {
          event.preventDefault()
          onNext()
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    keyboard,
    phase,
    q,
    flipped,
    stepsShown,
    instance.steps.length,
    instance.optionMap,
    canHint,
    canDrop,
    onNext,
    onFlag,
    onReroll,
    onHint,
    onStepDown,
    submit,
  ])

  /* -- rendering ------------------------------------------------------ */

  const showOutcome = phase === 'revealed' && !suppressFeedback && marking !== null
  const tier = tierOf(q)

  return (
    <article className={`qcard ${showOutcome ? `qcard-${marking.verdict}` : ''}`}>
      <header className="qcard-head">
        <span className="chip">{KIND_LABEL[q.kind]}</span>
        <span className="t-tiny t-dimmer qcard-tier" title={`Tier ${tier}`}>
          {TIER_LABEL[tier]}
        </span>
        <span className="spacer" />
        {q.source && <span className="t-mono t-tiny t-dimmer qcard-source">{q.source}</span>}
        <button
          type="button"
          className={`btn btn-quiet qcard-flag ${flagged ? 'is-flagged' : ''}`}
          onClick={onFlag}
          title={flagged ? 'Flagged — remove from mistake review' : 'Flag for mistake review (F)'}
          aria-pressed={flagged}
        >
          <Star size={15} aria-hidden="true" fill={flagged ? 'currentColor' : 'none'} />
          <span className="visually-hidden">{flagged ? 'Remove flag' : 'Flag this question'}</span>
        </button>
      </header>

      <h2 className="qcard-prompt">
        {q.kind === 'cloze' ? (
          <ClozePrompt
            prompt={instance.prompt}
            values={blanks}
            disabled={phase !== 'answering'}
            onChange={(i, value) =>
              setBlanks((prev) => {
                const next = [...prev]
                next[i] = value
                return next
              })
            }
            firstRef={firstInput}
          />
        ) : (
          <MarkishLine>{instance.prompt}</MarkishLine>
        )}
      </h2>

      {/* ---------------- inputs by kind ---------------- */}

      {(q.kind === 'mcq' || q.kind === 'multi') && (
        <ul className="options">
          {instance.options.map((option, position) => {
            // The card shows a shuffled order; everything it reports upward is
            // in the question's own indices, so marking never sees the shuffle.
            const index = instance.optionMap[position]
            const selected =
              q.kind === 'mcq' ? chosen === index : chosenMulti.includes(index)
            const isAnswer =
              q.kind === 'mcq' ? q.answerIndex === index : q.answerIndices.includes(index)
            const reveal = phase === 'revealed' && !suppressFeedback

            return (
              <li key={index}>
                <button
                  type="button"
                  className={[
                    'option',
                    selected ? 'is-selected' : '',
                    reveal && isAnswer ? 'is-answer' : '',
                    reveal && selected && !isAnswer ? 'is-mistake' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={phase !== 'answering'}
                  onClick={() => {
                    if (q.kind === 'mcq') setChosen(index)
                    else
                      setChosenMulti((prev) =>
                        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
                      )
                  }}
                >
                  <span className="option-key kbd">{position + 1}</span>
                  <span className="option-text">
                    <MarkishLine>{option}</MarkishLine>
                  </span>
                  {reveal && isAnswer && (
                    <span className="option-mark" aria-label="Correct answer">
                      <Check size={16} aria-hidden="true" />
                    </span>
                  )}
                  {reveal && selected && !isAnswer && (
                    <span className="option-mark" aria-label="What you chose">
                      <X size={16} aria-hidden="true" />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {(q.kind === 'short' || q.kind === 'computation') && (
        <div className="answer-entry">
          <input
            ref={firstInput}
            className="field answer-field"
            type="text"
            inputMode={q.kind === 'computation' ? 'decimal' : 'text'}
            value={text}
            disabled={phase !== 'answering'}
            placeholder={q.kind === 'computation' ? 'Your answer' : 'Type your answer'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (phase === 'revealed') onNext()
                else submit()
              }
            }}
            aria-label="Your answer"
          />
          {q.kind === 'computation' && q.unit && <span className="answer-unit">{q.unit}</span>}
        </div>
      )}

      {q.kind === 'recall' && (
        <div className="recall">
          {flipped || phase === 'revealed' ? (
            <div className="recall-answer">
              <p className="t-label">Answer</p>
              <Markish className="recall-answer-body">{instance.displayAnswer}</Markish>
            </div>
          ) : (
            <button type="button" className="recall-flip" onClick={() => setFlipped(true)}>
              <span className="row gap-2"><Eye size={16} aria-hidden="true" /><span className="t-h3">Show the answer</span></span>
              <span className="t-tiny t-dimmer">Answer it in your head first</span>
              <span className="kbd">SPACE</span>
            </button>
          )}
        </div>
      )}

      {/* ---------------- hint ---------------- */}

      {assist >= 1 && hint !== null && (
        <div className="hint">
          <span className="t-label hint-label">
            <Lightbulb size={13} aria-hidden="true" />
            Hint
          </span>
          <span className="hint-body">
            {q.hint ? <MarkishLine>{hint}</MarkishLine> : <span className="t-mono">{hint}</span>}
          </span>
        </div>
      )}

      {/* ---------------- stepped working ---------------- */}

      {q.kind === 'computation' && instance.steps.length > 0 && (
        <div className="steps">
          <p className="t-label">Working</p>
          <ol className="steps-list">
            {instance.steps.map((step, index) => {
              const visible = index < stepsShown || phase === 'revealed'
              return (
                <li key={index} className={visible ? 'step' : 'step step-hidden'}>
                  <span className="step-index t-mono">{index + 1}</span>
                  {visible ? (
                    <span className="step-text">
                      <MarkishLine>{step}</MarkishLine>
                    </span>
                  ) : (
                    <span className="step-blank" aria-label="hidden step" />
                  )}
                </li>
              )
            })}
          </ol>
          {phase === 'answering' && stepsShown < instance.steps.length && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setStepsShown((n) => n + 1)}
            >
              {stepsShown === 0 ? 'Show first step' : 'Next step'}
              <span className="kbd">SPACE</span>
            </button>
          )}
        </div>
      )}

      {/* ---------------- outcome ---------------- */}

      {showOutcome && (
        <div className={`outcome outcome-${marking.verdict}`}>
          <p className="outcome-head">
            <span className="outcome-verdict">
              {marking.verdict === 'correct'
                ? 'Correct'
                : marking.verdict === 'partial'
                  ? 'Partly right'
                  : 'Not quite'}
            </span>
            {marking.note && <span className="t-small t-dim outcome-note">{marking.note}</span>}
          </p>

          {marking.verdict !== 'correct' && q.kind !== 'recall' && (
            <p className="outcome-answer">
              <span className="t-label">Answer</span>
              <span className="outcome-answer-body">
                <MarkishLine>{instance.displayAnswer}</MarkishLine>
              </span>
            </p>
          )}

          {instance.explanation && (
            <Markish className="prose t-small outcome-explain">{instance.explanation}</Markish>
          )}
        </div>
      )}

      {phase === 'revealed' && suppressFeedback && (
        <p className="t-small t-dim outcome-held">Answer recorded. Results come at the end.</p>
      )}

      {/* ---------------- actions ---------------- */}

      <footer className="qcard-foot">
        {phase === 'answering' ? (
          <>
            {q.kind === 'recall' ? (
              flipped ? (
                <>
                  <span className="t-small t-dim">How did you go?</span>
                  <button type="button" className="btn btn-bad" onClick={() => selfGrade('wrong')}>
                    Missed it
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => selfGrade('partial')}
                  >
                    Partly
                  </button>
                  <button type="button" className="btn btn-good" onClick={() => selfGrade('correct')}>
                    Got it
                  </button>
                </>
              ) : (
                <span className="t-small t-dim">Answer it in your head, then reveal.</span>
              )
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={submit}
                disabled={!canSubmit}
              >
                Check
                <span className="kbd"><CornerDownLeft size={11} aria-hidden="true" /></span>
              </button>
            )}

            <span className="spacer" />

            {canHint && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={onHint}
                title="Show the shape of the answer"
              >
                <Lightbulb size={14} aria-hidden="true" />
                Hint
                <span className="kbd">H</span>
              </button>
            )}

            {canDrop && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={onStepDown}
                title="Swap for an easier question on this material — this one comes back later"
              >
                <ChevronsDown size={14} aria-hidden="true" />
                Easier
                <span className="kbd">E</span>
              </button>
            )}

            {isTemplated(q) && (
              <button type="button" className="btn btn-outline btn-sm" onClick={onReroll}>
                <Dice5 size={14} aria-hidden="true" />
                New numbers
                <span className="kbd">N</span>
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
              {nextLabel}
              <span className="kbd"><CornerDownLeft size={11} aria-hidden="true" /></span>
            </button>
            <span className="spacer" />
            {isTemplated(q) && (
              <span className="t-tiny t-dimmer">This one is generated — the numbers change each time.</span>
            )}
          </>
        )}
      </footer>
    </article>
  )
}

/* ------------------------------------------------------------------ */

/** Renders a cloze prompt, replacing {{1}} markers with inline inputs. */
function ClozePrompt({
  prompt,
  values,
  disabled,
  onChange,
  firstRef,
}: {
  prompt: string
  values: string[]
  disabled: boolean
  onChange: (index: number, value: string) => void
  firstRef: React.RefObject<HTMLInputElement | null>
}) {
  const parts = prompt.split(/(\{\{\s*\d+\s*\}\})/g)
  let blankIndex = -1

  return (
    <>
      {parts.map((part, i) => {
        const marker = /^\{\{\s*(\d+)\s*\}\}$/.exec(part)
        if (!marker) return <MarkishLine key={i}>{part}</MarkishLine>

        blankIndex += 1
        const index = blankIndex

        return (
          <input
            key={i}
            ref={index === 0 ? firstRef : undefined}
            className="cloze-input"
            type="text"
            size={Math.max(8, (values[index] ?? '').length + 2)}
            value={values[index] ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(index, e.target.value)}
            aria-label={`Blank ${index + 1}`}
          />
        )
      })}
    </>
  )
}
