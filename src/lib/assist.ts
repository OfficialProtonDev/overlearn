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
  2: 'Right after stepping down — logged as partial so the hard version comes back.',
}
