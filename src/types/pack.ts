/**
 * The pack format.
 *
 * This file is the contract between the ingestion skill (which writes packs)
 * and the app (which reads them). Anything the skill emits must typecheck
 * against these types, and `lib/validate.ts` enforces the same shape at
 * runtime with human-readable errors.
 *
 * A pack on disk is a folder:
 *
 *   compx310-test1/
 *     pack.json            <- PackManifest
 *     topics/
 *       foundations.json   <- Topic
 *       knn-and-trees.json <- Topic
 *
 * Topics live in separate files so the skill can regenerate one topic
 * without rewriting the whole pack, and so diffs stay readable.
 */

export const SCHEMA_VERSION = 1

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

export interface PackManifest {
  schemaVersion: number
  /** Stable slug. Progress is keyed on this, so changing it resets history. */
  id: string
  /** Shown as the pack's name, e.g. "COMPX310 · Test 1". */
  title: string
  /** Optional second line, e.g. "Machine Learning". */
  subtitle?: string
  description?: string
  /** ISO date the pack was generated. */
  generatedAt?: string
  /** Where the content came from, shown in the pack's About panel. */
  source?: PackSource
  /** Ordered. Each entry points at a file relative to the manifest. */
  topics: TopicRef[]
}

export interface PackSource {
  /** Short label, e.g. "7 lecture PDFs, 219 slides". */
  label: string
  /** Longer note — reading list, which lectures, caveats. */
  detail?: string
  /** Individual source documents, so citations can resolve to a real name. */
  documents?: SourceDocument[]
}

export interface SourceDocument {
  /** Citation key used in `source` fields, e.g. "c2". */
  key: string
  /** Human name, e.g. "c2_2026.pdf — Supervised Learning". */
  title: string
  pages?: number
}

export interface TopicRef {
  id: string
  title: string
  /** Path to the topic file, relative to pack.json. */
  file: string
}

/* ------------------------------------------------------------------ *
 * Topics and subtopics
 * ------------------------------------------------------------------ */

export interface Topic {
  id: string
  title: string
  /** One or two sentences: what this topic covers and why it matters. */
  summary?: string
  /** Formulas worth memorising. Feeds the cheat sheet. */
  formulas?: Formula[]
  /** Definitions worth memorising. Also feeds the cheat sheet. */
  keyFacts?: KeyFact[]
  subtopics: Subtopic[]
}

export interface Subtopic {
  id: string
  title: string
  /** The reference layer: a short recap shown beside the questions. */
  summary?: string
  /**
   * How central this is to the assessment. Drives the "what's examinable"
   * signal on the coverage map, and weighting in mock tests.
   */
  emphasis?: Emphasis
  formulas?: Formula[]
  keyFacts?: KeyFact[]
  questions: Question[]
}

export type Emphasis = 'core' | 'standard' | 'background'

export interface Formula {
  name: string
  /** Plain text, e.g. "Q = 2r(1 − r)". Rendered in the mono face. */
  expression: string
  /** What the symbols mean, when to reach for it. */
  note?: string
  source?: string
}

export interface KeyFact {
  term: string
  definition: string
  source?: string
}

/* ------------------------------------------------------------------ *
 * Questions
 * ------------------------------------------------------------------ */

export type Question =
  | McqQuestion
  | MultiQuestion
  | ShortQuestion
  | RecallQuestion
  | ClozeQuestion
  | ComputationQuestion

export type QuestionKind = Question['kind']

interface QuestionBase {
  /** Stable within the pack. Progress is keyed on it. */
  id: string
  /**
   * Difficulty tier, driving the escalating mode:
   *   1 recognition · 2 supply the answer · 3 produce it cold
   * Defaults are derived from `kind` when omitted.
   */
  tier?: 1 | 2 | 3
  /**
   * A nudge shown when you ask for one, before the answer is revealed.
   *
   * Points at the idea, never at the spelling: "think about what happens to
   * the variance", not "starts with 'over'". Optional — without one the app
   * falls back to the shape of the answer, which is weaker but always there.
   */
  hint?: string
  /** Citation into the source material, e.g. "c2 · slide 15". */
  source?: string
  /** Shown after answering. Supports the same light markup as summaries. */
  explanation?: string
  /** Free-form labels for filtering, e.g. ["formula", "definition"]. */
  tags?: string[]
}

/** Pick one of several options. */
export interface McqQuestion extends QuestionBase {
  kind: 'mcq'
  prompt: string
  options: string[]
  answerIndex: number
}

/** Pick every option that applies. Partial credit is reported but not awarded. */
export interface MultiQuestion extends QuestionBase {
  kind: 'multi'
  prompt: string
  options: string[]
  answerIndices: number[]
}

/** Type a short answer, checked leniently against the accepted forms. */
export interface ShortQuestion extends QuestionBase {
  kind: 'short'
  prompt: string
  /** Any one of these counts as correct. First is shown as the model answer. */
  answers: string[]
}

/** Shown, answered from memory, then graded by you. The flashcard case. */
export interface RecallQuestion extends QuestionBase {
  kind: 'recall'
  prompt: string
  answer: string
}

/** Fill the gaps. Blanks are written as {{1}}, {{2}} … in the prompt. */
export interface ClozeQuestion extends QuestionBase {
  kind: 'cloze'
  prompt: string
  /** One entry per blank, in order; each entry lists accepted answers. */
  blanks: string[][]
}

/**
 * A worked numeric problem.
 *
 * When `vars` is present the question is a template: values are drawn fresh
 * each time so the method gets drilled rather than the answer memorised.
 * Every string in the prompt, steps and explanation may contain {{ … }}
 * expressions, evaluated against the drawn variables.
 */
export interface ComputationQuestion extends QuestionBase {
  kind: 'computation'
  prompt: string
  /** Randomised inputs. Omit for a fixed problem. */
  vars?: Record<string, VarSpec>
  /** Values computed from `vars`, available to later expressions by name. */
  derived?: Record<string, string>
  /** Revealed one at a time. */
  steps: ComputationStep[]
  answer: ComputationAnswer
  /** Units shown beside the input, e.g. "cm", "%". */
  unit?: string
}

export interface ComputationStep {
  /** May contain {{ expressions }}. */
  text: string
}

export interface ComputationAnswer {
  /** Expression over the variables, e.g. "2*r*(1-r)". */
  expr: string
  /** Absolute tolerance for marking. Defaults to 1e-6. */
  tolerance?: number
  /** Round the displayed model answer to this many decimals. */
  decimals?: number
}

export type VarSpec =
  | { type: 'int'; min: number; max: number; step?: number }
  | { type: 'float'; min: number; max: number; decimals?: number }
  | { type: 'choice'; values: (number | string)[] }

/* ------------------------------------------------------------------ *
 * Loaded shape
 * ------------------------------------------------------------------ */

/** A manifest with its topic files resolved. This is what the app holds. */
export interface Pack {
  manifest: PackManifest
  topics: Topic[]
  /** Where it came from, for the library list. */
  origin: PackOrigin
  /** When it was loaded into this browser. */
  loadedAt: number
}

export type PackOrigin =
  | { kind: 'bundled'; path: string }
  | { kind: 'folder'; name: string }
  | { kind: 'file'; name: string }

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const DEFAULT_TIER: Record<QuestionKind, 1 | 2 | 3> = {
  mcq: 1,
  multi: 2,
  cloze: 2,
  short: 2,
  recall: 3,
  computation: 3,
}

export function tierOf(q: Question): 1 | 2 | 3 {
  return q.tier ?? DEFAULT_TIER[q.kind]
}

export const EMPHASIS_ORDER: Record<Emphasis, number> = {
  core: 0,
  standard: 1,
  background: 2,
}

export function emphasisOf(s: Subtopic): Emphasis {
  return s.emphasis ?? 'standard'
}
