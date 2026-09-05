/**
 * Marking answers.
 *
 * The guiding rule: never mark a right answer wrong over punctuation, case,
 * spacing, or a plural. A tool that argues with you about "confusion matrix"
 * vs "Confusion Matrices" stops getting used. Where a judgement call is close,
 * it is surfaced as `partial` and handed back to you rather than guessed at.
 */

import type { Question } from '../types/pack'
import type { QuestionInstance } from './instance'

export type Verdict = 'correct' | 'partial' | 'wrong'

export interface Marking {
  verdict: Verdict
  /** Shown under the answer when the verdict needs explaining. */
  note?: string
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

/** Words that carry no meaning for matching a short answer. */
const FILLER = new Set(['the', 'a', 'an', 'of', 'to', 'is', 'are', 'it', 'its', 'and'])

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Aggressive normalisation used for comparing free text. */
export function normalise(input: string): string {
  return stripDiacritics(input)
    .toLowerCase()
    .replace(/[’']/g, '')
    // Unify the maths characters people and PDFs disagree about.
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[^a-z0-9+\-*/^=.<>() ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalised, with filler words and trailing plurals removed. */
function contentWords(input: string): string[] {
  return normalise(input)
    .split(' ')
    .filter((w) => w.length > 0 && !FILLER.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

function canonical(input: string): string {
  return contentWords(input).join(' ')
}

/* ------------------------------------------------------------------ *
 * Edit distance, for typo tolerance
 * ------------------------------------------------------------------ */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)

  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const swap = prev
    prev = curr
    curr = swap
  }

  return prev[b.length]
}

/** How many typos to forgive at a given answer length. */
function typoBudget(length: number): number {
  if (length <= 4) return 0
  if (length <= 8) return 1
  if (length <= 16) return 2
  return 3
}

/**
 * Compare a typed answer against one accepted answer.
 * Returns 'exact' | 'close' | 'no'.
 */
function compareOne(given: string, expected: string): 'exact' | 'close' | 'no' {
  const g = canonical(given)
  const e = canonical(expected)
  if (!g) return 'no'
  if (g === e) return 'exact'

  // Numeric answers compare as numbers when both sides are numeric.
  const gn = Number(g.replace(/\s/g, ''))
  const en = Number(e.replace(/\s/g, ''))
  if (Number.isFinite(gn) && Number.isFinite(en)) {
    return Math.abs(gn - en) < 1e-9 ? 'exact' : 'no'
  }

  const distance = levenshtein(g, e)
  if (distance <= typoBudget(e.length)) return 'exact'

  // Answering with more than was asked for is fine; the expected answer
  // appearing as a whole phrase inside the response counts.
  if (e.length >= 4 && g.includes(e)) return 'exact'

  // Every meaningful word present, in any order.
  const gWords = new Set(contentWords(given))
  const eWords = contentWords(expected)
  if (eWords.length > 1 && eWords.every((w) => gWords.has(w))) return 'exact'

  // Most of the meaningful words present — right idea, imprecise wording.
  if (eWords.length > 1) {
    const hits = eWords.filter((w) => gWords.has(w)).length
    if (hits / eWords.length >= 0.6) return 'close'
  }

  return 'no'
}

/* ------------------------------------------------------------------ *
 * Public marking
 * ------------------------------------------------------------------ */

export function markShort(given: string, accepted: string[]): Marking {
  if (!given.trim()) return { verdict: 'wrong', note: 'Nothing entered.' }

  let best: 'exact' | 'close' | 'no' = 'no'
  for (const candidate of accepted) {
    const result = compareOne(given, candidate)
    if (result === 'exact') return { verdict: 'correct' }
    if (result === 'close') best = 'close'
  }

  if (best === 'close') {
    return {
      verdict: 'partial',
      note: 'Right idea, but not quite the expected wording — call it yourself.',
    }
  }
  return { verdict: 'wrong' }
}

export function markNumeric(
  given: string,
  expected: number | undefined,
  tolerance = 1e-6,
): Marking {
  if (!given.trim()) return { verdict: 'wrong', note: 'Nothing entered.' }
  if (expected === undefined) {
    return { verdict: 'partial', note: "This question's answer couldn't be computed — grade it yourself." }
  }

  // Accept "3/10" and "0.3" alike, and ignore a trailing unit or % sign.
  const cleaned = given.replace(/[^0-9+\-*/.eE ]/g, ' ').trim()
  let value = Number(cleaned)

  if (!Number.isFinite(value) && /^[-0-9.]+\s*\/\s*[-0-9.]+$/.test(cleaned)) {
    const [n, d] = cleaned.split('/').map((p) => Number(p.trim()))
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) value = n / d
  }

  if (!Number.isFinite(value)) {
    return { verdict: 'wrong', note: "That isn't a number I could read." }
  }

  if (Math.abs(value - expected) <= tolerance) return { verdict: 'correct' }

  // A rounding slip is worth distinguishing from a method error.
  if (Math.abs(value - expected) <= Math.max(tolerance * 100, Math.abs(expected) * 0.02)) {
    return { verdict: 'partial', note: 'Close — looks like a rounding difference rather than a method error.' }
  }

  return { verdict: 'wrong' }
}

export function markMcq(chosen: number | null, answerIndex: number): Marking {
  if (chosen === null) return { verdict: 'wrong', note: 'Nothing selected.' }
  return { verdict: chosen === answerIndex ? 'correct' : 'wrong' }
}

export function markMulti(chosen: number[], expected: number[]): Marking {
  if (chosen.length === 0) return { verdict: 'wrong', note: 'Nothing selected.' }

  const want = new Set(expected)
  const got = new Set(chosen)
  const hits = [...want].filter((i) => got.has(i)).length
  const extras = [...got].filter((i) => !want.has(i)).length

  if (hits === want.size && extras === 0) return { verdict: 'correct' }
  if (hits === 0) return { verdict: 'wrong' }

  const missed = want.size - hits
  const parts: string[] = []
  if (missed > 0) parts.push(`missed ${missed}`)
  if (extras > 0) parts.push(`${extras} shouldn't be there`)
  return { verdict: 'partial', note: parts.join(', ') }
}

export function markCloze(given: string[], blanks: string[][]): Marking {
  if (blanks.length === 0) return { verdict: 'wrong' }

  let correct = 0
  for (let i = 0; i < blanks.length; i++) {
    if (markShort(given[i] ?? '', blanks[i]).verdict === 'correct') correct++
  }

  if (correct === blanks.length) return { verdict: 'correct' }
  if (correct === 0) return { verdict: 'wrong' }
  return { verdict: 'partial', note: `${correct} of ${blanks.length} blanks right` }
}

/** Everything except `recall`, which only you can mark. */
export function isAutoMarked(question: Question): boolean {
  return question.kind !== 'recall'
}

/**
 * Mark whatever the runner collected for this instance.
 * `response` is shaped by the question kind; the runner keeps them in step.
 */
export type Response =
  | { kind: 'mcq'; chosen: number | null }
  | { kind: 'multi'; chosen: number[] }
  | { kind: 'short'; text: string }
  | { kind: 'cloze'; text: string[] }
  | { kind: 'computation'; text: string }
  | { kind: 'recall'; selfVerdict: Verdict }

export function mark(instance: QuestionInstance, response: Response): Marking {
  const q = instance.question

  switch (q.kind) {
    case 'mcq':
      return response.kind === 'mcq' ? markMcq(response.chosen, q.answerIndex) : { verdict: 'wrong' }
    case 'multi':
      return response.kind === 'multi'
        ? markMulti(response.chosen, q.answerIndices)
        : { verdict: 'wrong' }
    case 'short':
      return response.kind === 'short' ? markShort(response.text, q.answers) : { verdict: 'wrong' }
    case 'cloze':
      return response.kind === 'cloze' ? markCloze(response.text, q.blanks) : { verdict: 'wrong' }
    case 'computation':
      return response.kind === 'computation'
        ? markNumeric(response.text, instance.numericAnswer, q.answer.tolerance ?? 1e-6)
        : { verdict: 'wrong' }
    case 'recall':
      return response.kind === 'recall' ? { verdict: response.selfVerdict } : { verdict: 'wrong' }
  }
}
