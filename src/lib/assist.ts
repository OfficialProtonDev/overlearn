/**
 * Getting unstuck.
 *
 * Escalation is the point of the app: material you know comes back harder,
 * until you're producing it cold. The failure mode is the dead end — a typed
 * question on something you half-know, with nothing between "type it exactly"
 * and "give up and reveal the answer". Staring at a blank field teaches
 * nothing, and neither does reading the answer you were about to guess.
 *
 * Two ladders out, in order of how much they give away:
 *
 *  Hint — the shape of the answer. Enough to confirm a word you already had
 *  on the tip of your tongue, not enough to reconstruct one you didn't.
 *
 *  Step down — swap the question for an easier one on the same material, and
 *  put the hard one back later in the session. This is the one that matters:
 *  it hands you a real multiple-choice question with the pack's own
 *  distractors, rather than a fabricated one, and you meet the hard version
 *  again a few questions later with the reminder fresh.
 *
 * Either way the question is marked `partial` at best. Help is fine; help
 * that quietly counts as mastery is not.
 */

import type { Question } from '../types/pack'

/** 0 none · 1 hint shown · 2 answer given away by stepping down. */
export type AssistLevel = 0 | 1 | 2

/**
 * The shape of an answer: how many words, and the first letter of each.
 *
 * Returns null when a skeleton would give away everything (a one-letter
 * answer) or nothing (a paragraph). Recall answers in a real pack run to
 * fifty words, and "50 words · t···· i· ···" helps nobody.
 */
export function shapeHint(answer: string): string | null {
  const words = answer.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 8) return null
  if (words.length === 1 && words[0].length < 3) return null

  const skeleton = words
    .map((word) => (word.length <= 2 ? word : word[0] + '·'.repeat(word.length - 1)))
    .join(' ')

  return `${words.length} word${words.length === 1 ? '' : 's'} · ${skeleton}`
}

/**
 * The hint for a question, if it has one worth showing.
 *
 * A hint the pack wrote always wins — it can say something about the idea,
 * where a skeleton can only say something about the spelling.
 */
export function hintFor(question: Question): string | null {
  if (question.hint) return question.hint

  switch (question.kind) {
    case 'short':
      return shapeHint(question.answers[0] ?? '')
    case 'cloze': {
      const shapes = question.blanks.map((blank) => shapeHint(blank[0] ?? ''))
      if (shapes.every((s) => s === null)) return null
      return shapes.map((s, i) => `${i + 1}. ${s ?? '—'}`).join('   ')
    }
    case 'recall':
      return shapeHint(question.answer)
    default:
      return null
  }
}

/** Whether a hint exists for this question at all, without building it. */
export function hasHint(question: Question): boolean {
  return hintFor(question) !== null
}

/** The note recorded against an answer that needed help. */
export const ASSIST_NOTE: Record<1 | 2, string> = {
  1: 'Right, but with a hint — logged as partial so it comes back.',
  2: 'Right with the options in front of you — logged as partial so it comes back.',
}

/* ------------------------------------------------------------------ *
 * Turning a typed question back into a choice
 * ------------------------------------------------------------------ */

/**
 * Whether this question can honestly be re-asked as multiple choice.
 *
 * The test is whether the answer is short enough to sit in an option beside
 * three others. A one-line term works; a `recall` prompt whose answer runs to
 * fifty words does not — four paragraphs to choose between is not an easier
 * question, it's a reading comprehension test, and the distractors would have
 * to be invented rather than drawn from the pack.
 */
export function canBecomeChoices(question: Question): boolean {
  return answerToChoose(question) !== null
}

/** The single string this question wants back, if it wants exactly one. */
function answerToChoose(question: Question): string | null {
  const viable = (text: string | undefined) => {
    if (!text) return null
    const words = text.trim().split(/\s+/).filter(Boolean)
    return words.length > 0 && words.length <= 8 ? text.trim() : null
  }

  switch (question.kind) {
    case 'short':
      return viable(question.answers[0])
    case 'cloze':
      // Several blanks would need several sets of options, which is a worse
      // interface than the per-blank hint those questions already get.
      return question.blanks.length === 1 ? viable(question.blanks[0][0]) : null
    default:
      // `recall` is deliberately absent. Its answers run to a paragraph, and
      // the handful short enough to fit an option are graded by you rather
      // than by matching, so a choice there would have nothing to check
      // against. Those fall back to swapping in an easier question instead.
      return null
  }
}

/**
 * Rebuild this question as a set of options: the real answer, plus wrong ones
 * drawn from the pack itself.
 *
 * The distractors are real strings the pack already uses — other answers,
 * defined terms, authored multiple-choice options from nearby material. That
 * matters: a distractor invented on the spot is either absurd (and gives the
 * answer away) or accidentally correct. Ones the pack wrote are neither.
 *
 * Returns null rather than a two-option question, since a coin flip teaches
 * nothing.
 */
export function buildChoices(question: Question, pool: string[]): string[] | null {
  const answer = answerToChoose(question)
  if (answer === null) return null

  // Every form the question would accept is off the table as a distractor —
  // otherwise "regularisation" can appear opposite "regularization".
  const accepted = new Set<string>()
  if (question.kind === 'short') for (const a of question.answers) accepted.add(fold(a))
  else if (question.kind === 'cloze') for (const a of question.blanks[0]) accepted.add(fold(a))
  else accepted.add(fold(answer))

  const answerWords = answer.trim().split(/\s+/).length
  const seen = new Set<string>([...accepted])
  const candidates: { text: string; words: number }[] = []

  // Take a window off the front of the pool, which is already ordered by how
  // close the material is, then choose within it. Considering the whole pack
  // would find better-shaped strings from unrelated topics, which is the
  // wrong trade — a distractor from the same corner of the course is what
  // makes the question worth answering.
  for (const option of pool) {
    const text = option.trim()
    const key = fold(text)
    if (!text || seen.has(key)) continue
    if (!sameShapeAs(answer, text)) continue

    const words = text.split(/\s+/).length
    if (words > Math.max(8, answerWords * 3)) continue

    seen.add(key)
    candidates.push({ text, words })
    if (candidates.length >= 40) break
  }

  if (candidates.length < 2) return null

  // Prefer options shaped like the answer. A one-word term answered among
  // three full sentences gives itself away — the odd one out stops being a
  // distractor and becomes a hint.
  candidates.sort((a, b) => Math.abs(a.words - answerWords) - Math.abs(b.words - answerWords))
  const picked = candidates.slice(0, 3).map((c) => c.text)

  const options = [answer, ...picked]
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return options
}

/**
 * Is `candidate` the same *kind* of thing as `answer`?
 *
 * The pack's strings are a mixed bag: terms, sentences, single letters from
 * cloze blanks, bare numbers from worked examples. Offering "regularization"
 * against "T" and "60" is not a question, it's a giveaway — the answer is the
 * only option that could possibly be one. So a number only stands beside
 * numbers, and a term only beside things long enough to be a term.
 */
function sameShapeAs(answer: string, candidate: string): boolean {
  const numeric = (text: string) => /^[-+]?[\d.,/%]+$/.test(text.trim())
  if (numeric(answer) !== numeric(candidate)) return false

  // A stray initial from a cloze blank is never a plausible term.
  const substantial = (text: string) => text.replace(/[^a-z0-9]/gi, '').length >= 3
  return numeric(answer) || substantial(candidate)
}

/** Loose comparison key, so near-identical strings don't both appear. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
