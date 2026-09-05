/**
 * Turning a question into a concrete instance you can answer.
 *
 * Most questions are already concrete. Computation questions with `vars` are
 * templates: each time one is served, fresh values are drawn and every
 * {{ expression }} in the prompt, steps and explanation is resolved against
 * them. That is what "New numbers" does — the method gets drilled instead of
 * one answer getting memorised.
 */

import type { ComputationQuestion, Question, VarSpec } from '../types/pack'
import { evaluate, formatNumber, interpolate } from './expr'

export interface QuestionInstance {
  question: Question
  /** Prompt with any template expressions resolved. */
  prompt: string
  /** Steps with expressions resolved. Empty for non-computation questions. */
  steps: string[]
  /** Explanation with expressions resolved, if there is one. */
  explanation?: string
  /** The drawn variable values. Empty unless the question is a template. */
  scope: Record<string, number>
  /** Correct numeric answer, for computation questions. */
  numericAnswer?: number
  /** The model answer as displayed. */
  displayAnswer: string
  /** Bumped by "New numbers" so React remounts the input. */
  seed: number
}

/* ------------------------------------------------------------------ *
 * Drawing values
 * ------------------------------------------------------------------ */

function drawVar(spec: VarSpec, rand: () => number): number {
  switch (spec.type) {
    case 'int': {
      const step = spec.step && spec.step > 0 ? spec.step : 1
      const lo = Math.ceil(spec.min / step)
      const hi = Math.floor(spec.max / step)
      const n = hi - lo
      return (lo + Math.round(rand() * (n < 0 ? 0 : n))) * step
    }
    case 'float': {
      const raw = spec.min + rand() * (spec.max - spec.min)
      const d = spec.decimals ?? 2
      const f = Math.pow(10, d)
      return Math.round(raw * f) / f
    }
    case 'choice': {
      const values = spec.values
      if (values.length === 0) return 0
      const picked = values[Math.floor(rand() * values.length) % values.length]
      return typeof picked === 'number' ? picked : Number(picked)
    }
  }
}

function buildScope(q: ComputationQuestion, rand: () => number): Record<string, number> {
  const scope: Record<string, number> = {}

  for (const [name, spec] of Object.entries(q.vars ?? {})) {
    scope[name] = drawVar(spec, rand)
  }

  // Derived values may reference earlier derived values, so evaluate in
  // declaration order and let a failure fall through as 0 rather than
  // taking the whole question down.
  for (const [name, expr] of Object.entries(q.derived ?? {})) {
    try {
      scope[name] = evaluate(expr, scope)
    } catch {
      scope[name] = Number.NaN
    }
  }

  return scope
}

/* ------------------------------------------------------------------ *
 * Instancing
 * ------------------------------------------------------------------ */

/**
 * Build a concrete instance of `question`.
 *
 * `seed` is carried on the instance so callers can force a redraw by passing
 * a new one; the same seed does not reproduce the same draw, it only signals
 * "this is a different instance" to React.
 */
export function instantiate(question: Question, seed = 0): QuestionInstance {
  if (question.kind !== 'computation') {
    return {
      question,
      prompt: question.prompt,
      steps: [],
      explanation: question.explanation,
      scope: {},
      displayAnswer: staticAnswerOf(question),
      seed,
    }
  }

  const rand = Math.random
  const scope = buildScope(question, rand)

  let numericAnswer: number | undefined
  try {
    numericAnswer = evaluate(question.answer.expr, scope)
  } catch {
    numericAnswer = undefined
  }

  const decimals = question.answer.decimals
  const displayAnswer =
    numericAnswer === undefined
      ? '—'
      : formatNumber(numericAnswer, decimals) + (question.unit ? ` ${question.unit}` : '')

  return {
    question,
    prompt: interpolate(question.prompt, scope),
    steps: question.steps.map((s) => interpolate(s.text, scope)),
    explanation: question.explanation ? interpolate(question.explanation, scope) : undefined,
    scope,
    numericAnswer,
    displayAnswer,
    seed,
  }
}

/** The model answer for the non-computation kinds. */
function staticAnswerOf(question: Question): string {
  switch (question.kind) {
    case 'mcq':
      return question.options[question.answerIndex] ?? '—'
    case 'multi':
      return question.answerIndices
        .map((i) => question.options[i])
        .filter(Boolean)
        .join(' · ')
    case 'short':
      return question.answers[0] ?? '—'
    case 'recall':
      return question.answer
    case 'cloze':
      return question.blanks.map((b) => b[0] ?? '—').join(' · ')
    default:
      return '—'
  }
}

/** True when serving this question again will produce different numbers. */
export function isTemplated(question: Question): boolean {
  return question.kind === 'computation' && !!question.vars && Object.keys(question.vars).length > 0
}
