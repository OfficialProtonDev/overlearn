/**
 * What you know, and how the coverage map decides what colour to be.
 *
 * Only question-level records are stored. Everything shown on the coverage
 * map — subtopic mastery, topic rollups, the weakest-first ordering — is
 * derived from those on read, so the two can never drift apart.
 *
 * There is deliberately no spaced-repetition scheduling here. Sessions are
 * long single sittings rather than daily reviews, so recency is used only to
 * break ties, never to hide a question behind a due date.
 */

import type { Pack, Question, Subtopic, Topic } from '../types/pack'
import type { Verdict } from './grading'

/* ------------------------------------------------------------------ *
 * Stored shape
 * ------------------------------------------------------------------ */

export interface QuestionRecord {
  seen: number
  correct: number
  wrong: number
  /** Consecutive correct answers. Reset to 0 on a wrong answer. */
  streak: number
  lastVerdict: Verdict
  lastSeenAt: number
  /** Starred by you, to force it into Mistake review. */
  flagged?: boolean
}

export interface SessionRecord {
  id: string
  mode: string
  startedAt: number
  endedAt: number
  answered: number
  correct: number
  /** Subtopic ids covered, for the session summary. */
  subtopicIds: string[]
  /** Mock tests only. */
  score?: { correct: number; total: number; durationMs: number }
}

export interface PackProgress {
  packId: string
  questions: Record<string, QuestionRecord>
  sessions: SessionRecord[]
  /** Total milliseconds spent in sessions on this pack. */
  totalMs: number
  updatedAt: number
}

export function emptyProgress(packId: string): PackProgress {
  return { packId, questions: {}, sessions: [], totalMs: 0, updatedAt: Date.now() }
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

export function recordAnswer(
  progress: PackProgress,
  questionId: string,
  verdict: Verdict,
): PackProgress {
  const prev = progress.questions[questionId]
  const base: QuestionRecord = prev ?? {
    seen: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    lastVerdict: 'wrong',
    lastSeenAt: 0,
  }

  // A partial answer neither builds a streak nor destroys one. It is an
  // honest "not yet" — the question stays in circulation without being
  // treated as a failure.
  const streak =
    verdict === 'correct' ? base.streak + 1 : verdict === 'wrong' ? 0 : base.streak

  return {
    ...progress,
    questions: {
      ...progress.questions,
      [questionId]: {
        ...base,
        seen: base.seen + 1,
        correct: base.correct + (verdict === 'correct' ? 1 : 0),
        wrong: base.wrong + (verdict === 'wrong' ? 1 : 0),
        streak,
        lastVerdict: verdict,
        lastSeenAt: Date.now(),
      },
    },
    updatedAt: Date.now(),
  }
}

export function toggleFlag(progress: PackProgress, questionId: string): PackProgress {
  const prev = progress.questions[questionId]
  const base: QuestionRecord = prev ?? {
    seen: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    lastVerdict: 'wrong',
    lastSeenAt: 0,
  }
  return {
    ...progress,
    questions: { ...progress.questions, [questionId]: { ...base, flagged: !base.flagged } },
    updatedAt: Date.now(),
  }
}

/* ------------------------------------------------------------------ *
 * Mastery
 * ------------------------------------------------------------------ */

/**
 * Confidence in a single question, 0–1.
 *
 * Two correct answers in a row is treated as knowing it; one is promising but
 * could be luck on a four-option question. A recent wrong answer drops it low
 * without zeroing it, so a single slip doesn't erase a topic you'd built up.
 */
export function questionScore(record: QuestionRecord | undefined): number {
  if (!record || record.seen === 0) return 0
  if (record.lastVerdict === 'wrong') return 0.12
  if (record.lastVerdict === 'partial') return 0.45
  if (record.streak >= 3) return 1
  if (record.streak === 2) return 0.9
  return 0.65
}

export type MasteryState = 'untouched' | 'weak' | 'shaky' | 'strong'

export interface Mastery {
  /** 0–1, averaged over every question in the unit. */
  score: number
  state: MasteryState
  total: number
  seen: number
  correct: number
  /** Questions currently sitting on a wrong answer. */
  failing: number
}

export function masteryOf(questions: Question[], progress: PackProgress): Mastery {
  const total = questions.length
  if (total === 0) {
    return { score: 0, state: 'untouched', total: 0, seen: 0, correct: 0, failing: 0 }
  }

  let sum = 0
  let seen = 0
  let correct = 0
  let failing = 0

  for (const q of questions) {
    const record = progress.questions[q.id]
    sum += questionScore(record)
    if (record && record.seen > 0) {
      seen++
      if (record.lastVerdict === 'correct') correct++
      if (record.lastVerdict === 'wrong') failing++
    }
  }

  const score = sum / total
  return { score, state: stateFor(score, seen), total, seen, correct, failing }
}

function stateFor(score: number, seen: number): MasteryState {
  if (seen === 0) return 'untouched'
  if (score < 0.35) return 'weak'
  if (score < 0.72) return 'shaky'
  return 'strong'
}

export const STATE_LABEL: Record<MasteryState, string> = {
  untouched: 'Not started',
  weak: 'Weak',
  shaky: 'Shaky',
  strong: 'Solid',
}

/* ------------------------------------------------------------------ *
 * Rollups
 * ------------------------------------------------------------------ */

export function subtopicQuestions(subtopic: Subtopic): Question[] {
  return subtopic.questions
}

export function topicQuestions(topic: Topic): Question[] {
  return topic.subtopics.flatMap((s) => s.questions)
}

export function packQuestions(pack: Pack): Question[] {
  return pack.topics.flatMap(topicQuestions)
}

/** Every subtopic in the pack, paired with its parent topic. */
export function allSubtopics(pack: Pack): { topic: Topic; subtopic: Subtopic }[] {
  return pack.topics.flatMap((topic) => topic.subtopics.map((subtopic) => ({ topic, subtopic })))
}

export interface SubtopicStat {
  topic: Topic
  subtopic: Subtopic
  mastery: Mastery
}

export function subtopicStats(pack: Pack, progress: PackProgress): SubtopicStat[] {
  return allSubtopics(pack).map(({ topic, subtopic }) => ({
    topic,
    subtopic,
    mastery: masteryOf(subtopic.questions, progress),
  }))
}

/**
 * Weakest first, but untouched material outranks merely shaky material —
 * a blind spot costs more in a test than a wobble on something you've seen.
 */
export function weakestFirst(stats: SubtopicStat[]): SubtopicStat[] {
  const rank: Record<MasteryState, number> = { untouched: 0, weak: 1, shaky: 2, strong: 3 }
  return [...stats].sort((a, b) => {
    const byState = rank[a.mastery.state] - rank[b.mastery.state]
    if (byState !== 0) return byState
    return a.mastery.score - b.mastery.score
  })
}

/* ------------------------------------------------------------------ *
 * Mistake review
 * ------------------------------------------------------------------ */

/** Questions sitting on a wrong or partial answer, plus anything flagged. */
export function mistakeQuestions(pack: Pack, progress: PackProgress): Question[] {
  return packQuestions(pack).filter((q) => {
    const record = progress.questions[q.id]
    if (!record) return false
    if (record.flagged) return true
    return record.seen > 0 && record.lastVerdict !== 'correct'
  })
}

/* ------------------------------------------------------------------ *
 * Session totals
 * ------------------------------------------------------------------ */

export function totalAnswered(progress: PackProgress): number {
  return Object.values(progress.questions).reduce((n, r) => n + (r.seen > 0 ? 1 : 0), 0)
}

export function closeSession(progress: PackProgress, record: SessionRecord): PackProgress {
  return {
    ...progress,
    sessions: [...progress.sessions, record].slice(-60),
    totalMs: progress.totalMs + Math.max(0, record.endedAt - record.startedAt),
    updatedAt: Date.now(),
  }
}
