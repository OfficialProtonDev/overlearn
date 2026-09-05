/**
 * Runtime validation of pack files.
 *
 * A pack is usually machine-generated, so the failure mode to design for is a
 * subtly malformed file rather than a hostile one. Every problem is reported
 * with the path that caused it ("topics[2].subtopics[0].questions[5]") so the
 * ingestion skill — or you, editing by hand — can go straight to it.
 *
 * Validation is strict about anything that would break the app and lenient
 * about everything else: unknown extra fields are left alone.
 */

import {
  SCHEMA_VERSION,
  type PackManifest,
  type Question,
  type Topic,
} from '../types/pack'
import { evaluate, extractExpressions, isEvaluable } from './expr'

export interface Issue {
  path: string
  message: string
  /** Errors block loading. Warnings are shown but the pack still loads. */
  severity: 'error' | 'warning'
}

export interface ValidationResult<T> {
  value: T | null
  issues: Issue[]
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

class Collector {
  readonly issues: Issue[] = []

  error(path: string, message: string): void {
    this.issues.push({ path, message, severity: 'error' })
  }

  warn(path: string, message: string): void {
    this.issues.push({ path, message, severity: 'warning' })
  }

  requireString(value: unknown, path: string, field: string): boolean {
    if (!isNonEmptyString(value)) {
      this.error(path, `${field} is required and must be a non-empty string`)
      return false
    }
    return true
  }
}

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

export function validateManifest(raw: unknown): ValidationResult<PackManifest> {
  const c = new Collector()

  if (!isRecord(raw)) {
    c.error('pack.json', 'the file must contain a JSON object')
    return { value: null, issues: c.issues }
  }

  const version = raw.schemaVersion
  if (typeof version !== 'number') {
    c.error('pack.json', 'schemaVersion is required and must be a number')
  } else if (version > SCHEMA_VERSION) {
    c.error(
      'pack.json',
      `this pack uses schema version ${version}, but this build of Overlearn understands version ${SCHEMA_VERSION}. Update the app.`,
    )
  } else if (version < SCHEMA_VERSION) {
    c.warn('pack.json', `schema version ${version} is older than ${SCHEMA_VERSION}; loading anyway`)
  }

  c.requireString(raw.id, 'pack.json', 'id')
  c.requireString(raw.title, 'pack.json', 'title')

  if (isNonEmptyString(raw.id) && !/^[a-z0-9][a-z0-9-]*$/.test(raw.id)) {
    c.error(
      'pack.json',
      `id "${raw.id}" must be lowercase letters, digits and hyphens — it is used as a storage key and in URLs`,
    )
  }

  const topics = raw.topics
  if (!Array.isArray(topics) || topics.length === 0) {
    c.error('pack.json', 'topics must be a non-empty array')
    return { value: null, issues: c.issues }
  }

  const seen = new Set<string>()
  topics.forEach((t, i) => {
    const path = `pack.json topics[${i}]`
    if (!isRecord(t)) {
      c.error(path, 'each topic entry must be an object')
      return
    }
    c.requireString(t.id, path, 'id')
    c.requireString(t.title, path, 'title')
    c.requireString(t.file, path, 'file')

    if (isNonEmptyString(t.id)) {
      if (seen.has(t.id)) c.error(path, `duplicate topic id "${t.id}"`)
      seen.add(t.id)
    }
    if (isNonEmptyString(t.file) && (t.file.startsWith('/') || t.file.includes('..'))) {
      c.error(path, `file "${t.file}" must be a relative path inside the pack folder`)
    }
  })

  if (hasErrors(c.issues)) return { value: null, issues: c.issues }
  return { value: raw as unknown as PackManifest, issues: c.issues }
}

/* ------------------------------------------------------------------ *
 * Topics
 * ------------------------------------------------------------------ */

export function validateTopic(raw: unknown, file: string): ValidationResult<Topic> {
  const c = new Collector()

  if (!isRecord(raw)) {
    c.error(file, 'the file must contain a JSON object')
    return { value: null, issues: c.issues }
  }

  c.requireString(raw.id, file, 'id')
  c.requireString(raw.title, file, 'title')

  const subtopics = raw.subtopics
  if (!Array.isArray(subtopics) || subtopics.length === 0) {
    c.error(file, 'subtopics must be a non-empty array')
    return { value: null, issues: c.issues }
  }

  subtopics.forEach((s, i) => validateSubtopic(s, `${file} subtopics[${i}]`, c))

  if (hasErrors(c.issues)) return { value: null, issues: c.issues }
  return { value: raw as unknown as Topic, issues: c.issues }
}

function validateSubtopic(raw: unknown, path: string, c: Collector): void {
  if (!isRecord(raw)) {
    c.error(path, 'each subtopic must be an object')
    return
  }

  c.requireString(raw.id, path, 'id')
  c.requireString(raw.title, path, 'title')

  if (raw.emphasis !== undefined && !['core', 'standard', 'background'].includes(raw.emphasis as string)) {
    c.error(path, `emphasis must be "core", "standard" or "background", got "${String(raw.emphasis)}"`)
  }

  const questions = raw.questions
  if (!Array.isArray(questions)) {
    c.error(path, 'questions must be an array')
    return
  }
  if (questions.length === 0) {
    c.warn(path, 'this subtopic has no questions, so it will always read as untouched')
    return
  }

  questions.forEach((q, i) => validateQuestion(q, `${path} questions[${i}]`, c))
}

/* ------------------------------------------------------------------ *
 * Questions
 * ------------------------------------------------------------------ */

const KINDS = ['mcq', 'multi', 'short', 'recall', 'cloze', 'computation']

function validateQuestion(raw: unknown, path: string, c: Collector): void {
  if (!isRecord(raw)) {
    c.error(path, 'each question must be an object')
    return
  }

  c.requireString(raw.id, path, 'id')
  c.requireString(raw.prompt, path, 'prompt')

  const kind = raw.kind
  if (!isNonEmptyString(kind) || !KINDS.includes(kind)) {
    c.error(path, `kind must be one of ${KINDS.join(', ')} — got "${String(kind)}"`)
    return
  }

  if (raw.tier !== undefined && ![1, 2, 3].includes(raw.tier as number)) {
    c.error(path, 'tier must be 1, 2 or 3')
  }

  switch (kind) {
    case 'mcq':
      validateOptions(raw, path, c)
      if (typeof raw.answerIndex !== 'number') {
        c.error(path, 'answerIndex is required for an mcq question')
      } else if (
        Array.isArray(raw.options) &&
        (raw.answerIndex < 0 || raw.answerIndex >= raw.options.length)
      ) {
        c.error(path, `answerIndex ${raw.answerIndex} is outside options (0..${raw.options.length - 1})`)
      }
      break

    case 'multi': {
      validateOptions(raw, path, c)
      const indices = raw.answerIndices
      if (!Array.isArray(indices) || indices.length === 0) {
        c.error(path, 'answerIndices must be a non-empty array for a multi question')
      } else if (Array.isArray(raw.options)) {
        for (const idx of indices) {
          if (typeof idx !== 'number' || idx < 0 || idx >= raw.options.length) {
            c.error(path, `answerIndices contains ${String(idx)}, which is outside options`)
          }
        }
      }
      break
    }

    case 'short':
      if (!Array.isArray(raw.answers) || raw.answers.length === 0) {
        c.error(path, 'answers must be a non-empty array of accepted strings')
      } else if (!raw.answers.every(isNonEmptyString)) {
        c.error(path, 'every entry in answers must be a non-empty string')
      }
      break

    case 'recall':
      c.requireString(raw.answer, path, 'answer')
      break

    case 'cloze': {
      const blanks = raw.blanks
      if (!Array.isArray(blanks) || blanks.length === 0) {
        c.error(path, 'blanks must be a non-empty array')
        break
      }
      blanks.forEach((b, i) => {
        if (!Array.isArray(b) || b.length === 0 || !b.every(isNonEmptyString)) {
          c.error(path, `blanks[${i}] must be a non-empty array of accepted strings`)
        }
      })
      if (isNonEmptyString(raw.prompt)) {
        const markers = raw.prompt.match(/\{\{\s*\d+\s*\}\}/g) ?? []
        if (markers.length !== blanks.length) {
          c.error(
            path,
            `prompt has ${markers.length} blank marker(s) but blanks has ${blanks.length} entry/entries — they must match`,
          )
        }
      }
      break
    }

    case 'computation':
      validateComputation(raw, path, c)
      break
  }
}

function validateOptions(raw: Record<string, unknown>, path: string, c: Collector): void {
  const options = raw.options
  if (!Array.isArray(options) || options.length < 2) {
    c.error(path, 'options must be an array of at least two strings')
    return
  }
  if (!options.every(isNonEmptyString)) {
    c.error(path, 'every option must be a non-empty string')
    return
  }
  const unique = new Set(options.map((o) => (o as string).trim().toLowerCase()))
  if (unique.size !== options.length) {
    c.warn(path, 'two or more options are identical, which makes the question unanswerable')
  }
}

function validateComputation(raw: Record<string, unknown>, path: string, c: Collector): void {
  const steps = raw.steps
  if (!Array.isArray(steps) || steps.length === 0) {
    c.error(path, 'steps must be a non-empty array — stepped reveal is the point of this kind')
  }

  const answer = raw.answer
  if (!isRecord(answer) || !isNonEmptyString(answer.expr)) {
    c.error(path, 'answer.expr is required and must be an expression string')
    return
  }

  // Build a plausible scope from the declared variables so expressions can be
  // checked without drawing real values.
  const scope: Record<string, number> = {}
  const vars = raw.vars
  if (vars !== undefined) {
    if (!isRecord(vars)) {
      c.error(path, 'vars must be an object mapping names to specs')
    } else {
      for (const [name, spec] of Object.entries(vars)) {
        if (!isRecord(spec)) {
          c.error(path, `vars.${name} must be an object`)
          continue
        }
        if (spec.type === 'int' || spec.type === 'float') {
          if (typeof spec.min !== 'number' || typeof spec.max !== 'number') {
            c.error(path, `vars.${name} needs numeric min and max`)
            continue
          }
          if (spec.min > spec.max) c.error(path, `vars.${name} has min greater than max`)
          scope[name] = (spec.min + spec.max) / 2
        } else if (spec.type === 'choice') {
          if (!Array.isArray(spec.values) || spec.values.length === 0) {
            c.error(path, `vars.${name} needs a non-empty values array`)
            continue
          }
          scope[name] = Number(spec.values[0]) || 1
        } else {
          c.error(path, `vars.${name}.type must be "int", "float" or "choice"`)
        }
      }
    }
  }

  const derived = raw.derived
  if (derived !== undefined) {
    if (!isRecord(derived)) {
      c.error(path, 'derived must be an object mapping names to expressions')
    } else {
      for (const [name, expr] of Object.entries(derived)) {
        if (!isNonEmptyString(expr)) {
          c.error(path, `derived.${name} must be an expression string`)
          continue
        }
        if (!isEvaluable(expr, scope)) {
          c.error(path, `derived.${name} = "${expr}" could not be evaluated`)
          scope[name] = 1
          continue
        }
        // Bind the real derived value, so later expressions are checked
        // against something realistic. Binding a placeholder here would
        // reject good expressions — ln(1 - r) is fine for the r this
        // question actually draws, but not for an arbitrary stand-in.
        try {
          scope[name] = evaluate(expr, scope)
        } catch {
          scope[name] = 1
        }
      }
    }
  }

  if (!isEvaluable(answer.expr as string, scope)) {
    c.error(
      path,
      `answer.expr = "${String(answer.expr)}" could not be evaluated against the declared variables`,
    )
  }

  // Every {{ … }} in the visible text has to resolve, or the question renders
  // with ⟨error⟩ in it.
  const texts: string[] = []
  if (isNonEmptyString(raw.prompt)) texts.push(raw.prompt)
  if (isNonEmptyString(raw.explanation)) texts.push(raw.explanation)
  if (Array.isArray(steps)) {
    for (const s of steps) {
      if (isRecord(s) && isNonEmptyString(s.text)) texts.push(s.text)
    }
  }

  for (const text of texts) {
    for (const expr of extractExpressions(text)) {
      if (!isEvaluable(expr, scope)) {
        c.error(path, `the expression {{${expr}}} could not be evaluated`)
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Whole-pack checks
 * ------------------------------------------------------------------ */

/** Duplicate ids across topics would collide in the progress store. */
export function checkIdCollisions(topics: Topic[]): Issue[] {
  const issues: Issue[] = []
  const subtopicIds = new Map<string, string>()
  const questionIds = new Map<string, string>()

  for (const topic of topics) {
    for (const subtopic of topic.subtopics) {
      const prev = subtopicIds.get(subtopic.id)
      if (prev) {
        issues.push({
          path: `${topic.id}/${subtopic.id}`,
          message: `subtopic id "${subtopic.id}" is already used in topic "${prev}" — ids must be unique across the pack`,
          severity: 'error',
        })
      }
      subtopicIds.set(subtopic.id, topic.id)

      for (const question of subtopic.questions) {
        const prevQ = questionIds.get(question.id)
        if (prevQ) {
          issues.push({
            path: `${topic.id}/${subtopic.id}/${question.id}`,
            message: `question id "${question.id}" is already used in "${prevQ}" — progress is keyed on it, so ids must be unique across the pack`,
            severity: 'error',
          })
        }
        questionIds.set(question.id, `${topic.id}/${subtopic.id}`)
      }
    }
  }

  return issues
}

/** A one-line summary for the load report. */
export function summarise(topics: Topic[]): { topics: number; subtopics: number; questions: number } {
  let subtopics = 0
  let questions = 0
  for (const topic of topics) {
    subtopics += topic.subtopics.length
    for (const s of topic.subtopics) questions += s.questions.length
  }
  return { topics: topics.length, subtopics, questions }
}

/** Helper for tests and for the loader's typed passthrough. */
export function validateQuestionShape(raw: unknown, path = 'question'): Issue[] {
  const c = new Collector()
  validateQuestion(raw, path, c)
  return c.issues
}

export type { Question }
