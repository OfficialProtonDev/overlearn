/**
 * Building and running a session queue.
 *
 * Two behaviours matter here, both taken from how a long cram actually goes:
 *
 *  Escalation — a subtopic you've never touched opens with recognition
 *  questions. Once those are landing, the same material comes back as supply
 *  and then as cold recall. You are never dropped into the hardest form of a
 *  topic you haven't warmed up on, and never left grinding multiple choice on
 *  something you clearly know.
 *
 *  Requeuing — a question you get wrong comes back later in the same sitting,
 *  far enough away that you're recalling it rather than echoing it, and it
 *  keeps coming back until you get it right. Nothing is deferred to tomorrow,
 *  because for this use there is no tomorrow.
 */

import type { Pack, Question, Subtopic, Topic } from '../types/pack'
import { tierOf } from '../types/pack'
import type { Verdict } from './grading'
import { masteryOf, mistakeQuestions, type PackProgress } from './progress'

export type SessionMode = 'quiz' | 'flashcards' | 'rapidfire' | 'mock' | 'mistakes'

export const MODE_LABEL: Record<SessionMode, string> = {
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  rapidfire: 'Rapid fire',
  mock: 'Mock test',
  mistakes: 'Mistake review',
}

export interface SessionSpec {
  mode: SessionMode
  /** Subtopic ids to draw from. Empty means the whole pack. */
  subtopicIds: string[]
  /** Cap on questions. Mock tests always use it; other modes may run open. */
  limit?: number
  /** Mock tests only, in minutes. */
  minutes?: number
}

export interface QueueItem {
  question: Question
  subtopicId: string
  subtopicTitle: string
  topicTitle: string
  /** Bumped each time the item is requeued, so React sees a fresh instance. */
  attempt: number
}

/* ------------------------------------------------------------------ *
 * Selecting questions
 * ------------------------------------------------------------------ */

interface Located {
  question: Question
  subtopic: Subtopic
  topic: Topic
}

function locateAll(pack: Pack): Located[] {
  return pack.topics.flatMap((topic) =>
    topic.subtopics.flatMap((subtopic) =>
      subtopic.questions.map((question) => ({ question, subtopic, topic })),
    ),
  )
}

/**
 * The highest tier this subtopic has earned.
 *
 * Untouched material starts at tier 1. Landing tier 1 unlocks tier 2, and a
 * genuinely solid subtopic unlocks tier 3. Tiers are cumulative — unlocking
 * tier 3 does not stop tier 1 questions appearing, it just stops them
 * dominating.
 */
function unlockedTier(subtopic: Subtopic, progress: PackProgress): 1 | 2 | 3 {
  const mastery = masteryOf(subtopic.questions, progress)
  if (mastery.state === 'untouched' || mastery.score < 0.35) return 1
  if (mastery.score < 0.7) return 2
  return 3
}

/**
 * Serve each subtopic at the tier it has earned.
 *
 * The ceiling is a preference, not a hard filter. A subtopic whose questions
 * all sit above its ceiling is still asked — at the lowest tier it actually
 * has — because otherwise material written entirely as cold recall would be
 * unreachable until it had somehow already been learned, and a fresh pack
 * would open with a quiz two questions long.
 */
function selectByTier(items: Located[], progress: PackProgress): Located[] {
  const out: Located[] = []

  for (const group of groupBySubtopic(items)) {
    const ceiling = unlockedTier(group[0].subtopic, progress)
    const withinCeiling = group.filter((i) => tierOf(i.question) <= ceiling)

    if (withinCeiling.length > 0) {
      out.push(...withinCeiling)
      continue
    }

    const lowest = Math.min(...group.map((i) => tierOf(i.question)))
    out.push(...group.filter((i) => tierOf(i.question) === lowest))
  }

  return out
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Round-robin across subtopics so consecutive questions rarely come from the
 * same one. Blocking by subtopic feels easier at the time and retains worse;
 * this is the interleaving the mock and rapid-fire modes rely on.
 */
function interleave(groups: Located[][]): Located[] {
  const out: Located[] = []
  const queues = groups.map((g) => shuffle(g))
  let remaining = queues.reduce((n, q) => n + q.length, 0)

  while (remaining > 0) {
    for (const queue of queues) {
      const next = queue.shift()
      if (next) {
        out.push(next)
        remaining--
      }
    }
  }

  return out
}

function groupBySubtopic(items: Located[]): Located[][] {
  const map = new Map<string, Located[]>()
  for (const item of items) {
    const list = map.get(item.subtopic.id)
    if (list) list.push(item)
    else map.set(item.subtopic.id, [item])
  }
  return [...map.values()]
}

function toQueueItem(located: Located): QueueItem {
  return {
    question: located.question,
    subtopicId: located.subtopic.id,
    subtopicTitle: located.subtopic.title,
    topicTitle: located.topic.title,
    attempt: 0,
  }
}

/* ------------------------------------------------------------------ *
 * Queue construction
 * ------------------------------------------------------------------ */

export function buildQueue(pack: Pack, progress: PackProgress, spec: SessionSpec): QueueItem[] {
  const wanted = new Set(spec.subtopicIds)
  const inScope = (item: Located) => wanted.size === 0 || wanted.has(item.subtopic.id)

  let pool: Located[]

  switch (spec.mode) {
    case 'mistakes': {
      const ids = new Set(mistakeQuestions(pack, progress).map((q) => q.id))
      pool = locateAll(pack).filter((i) => ids.has(i.question.id) && inScope(i))
      break
    }

    case 'flashcards': {
      // Flashcards are the cold-recall form: prefer questions that ask you to
      // produce the answer, and fall back to anything if a subtopic has none.
      const scoped = locateAll(pack).filter(inScope)
      const recall = scoped.filter((i) => i.question.kind === 'recall')
      pool = recall.length > 0 ? recall : scoped.filter((i) => tierOf(i.question) >= 2)
      if (pool.length === 0) pool = scoped
      break
    }

    case 'rapidfire': {
      // Recognition only — this mode is for warming up and finding gaps fast.
      const scoped = locateAll(pack).filter(inScope)
      pool = scoped.filter((i) => tierOf(i.question) === 1)
      if (pool.length === 0) pool = scoped
      break
    }

    case 'mock': {
      // Everything in scope, weighted toward what the pack marks as core.
      const scoped = locateAll(pack).filter(inScope)
      pool = weightByEmphasis(scoped)
      break
    }

    case 'quiz':
    default: {
      // The escalating path: serve each subtopic at the tier it has earned.
      const scoped = locateAll(pack).filter(inScope)
      pool = selectByTier(scoped, progress)
      if (pool.length === 0) pool = scoped
      break
    }
  }

  if (pool.length === 0) return []

  const ordered =
    spec.mode === 'quiz' && wanted.size === 1
      ? shuffle(pool) // a single subtopic can't be interleaved
      : interleave(groupBySubtopic(pool))

  const limited = spec.limit ? ordered.slice(0, spec.limit) : ordered
  return limited.map(toQueueItem)
}

/**
 * Duplicate core-emphasis questions so they surface more often in a mock,
 * and thin out background material. Marked emphasis is the pack's own claim
 * about what is examinable, so this is where that claim pays off.
 */
function weightByEmphasis(items: Located[]): Located[] {
  const out: Located[] = []
  for (const item of items) {
    const emphasis = item.subtopic.emphasis ?? 'standard'
    if (emphasis === 'core') out.push(item, item)
    else if (emphasis === 'standard') out.push(item)
    else if (Math.random() < 0.5) out.push(item)
  }
  // Deduplicate identical questions that landed adjacent after weighting.
  return out
}

/* ------------------------------------------------------------------ *
 * Requeuing
 * ------------------------------------------------------------------ */

/** How far ahead a missed question is put back. */
const REQUEUE_GAP: Record<number, number> = {
  0: 4, // first miss: soon, but not immediately
  1: 9, // missed again: further out
  2: 16,
}
const MAX_ATTEMPTS = 4

/**
 * Insert `item` back into the remaining queue after a wrong or partial answer.
 * Returns the queue unchanged once an item has had enough goes — at that point
 * it stays in Mistake review rather than blocking the session.
 */
export function requeue(rest: QueueItem[], item: QueueItem, verdict: Verdict): QueueItem[] {
  if (verdict === 'correct') return rest
  if (item.attempt + 1 >= MAX_ATTEMPTS) return rest

  const gap = REQUEUE_GAP[item.attempt] ?? 16
  const at = Math.min(gap, rest.length)
  const next: QueueItem = { ...item, attempt: item.attempt + 1 }
  return [...rest.slice(0, at), next, ...rest.slice(at)]
}

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

export function defaultLimit(mode: SessionMode, available: number): number | undefined {
  if (mode === 'mock') return Math.min(30, available)
  if (mode === 'rapidfire') return Math.min(25, available)
  return undefined
}

export function estimateMinutes(mode: SessionMode, count: number): number {
  const perQuestion: Record<SessionMode, number> = {
    rapidfire: 0.2,
    flashcards: 0.4,
    quiz: 0.7,
    mistakes: 0.8,
    mock: 1.2,
  }
  return Math.max(1, Math.round(count * perQuestion[mode]))
}
