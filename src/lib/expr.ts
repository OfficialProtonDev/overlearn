/**
 * A small, safe arithmetic evaluator.
 *
 * Computation questions carry expressions written by the ingestion skill
 * ("2*r*(1-r)", "round(tp/(tp+fp), 3)"). Those strings come from pack files,
 * which may have been generated or hand-edited by someone other than the
 * person running the app — so they are never handed to eval() or Function().
 * This is a recursive-descent parser over a fixed grammar with a fixed
 * function table. Nothing else is reachable.
 *
 * Grammar (lowest precedence first):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('-' | '+') unary | power
 *   power   := primary ('^' unary)?          -- right associative
 *   primary := number | name | name '(' args ')' | '(' expr ')'
 */

export class ExprError extends Error {}

type Token =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  sign: Math.sign,
  sqrt: Math.sqrt,
  // round(x) or round(x, decimals)
  round: (x: number, d = 0) => {
    const f = Math.pow(10, d)
    return Math.round(x * f) / f
  },
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
}

/* ------------------------------------------------------------------ *
 * Tokeniser
 * ------------------------------------------------------------------ */

function tokenise(src: string): Token[] {
  const out: Token[] = []
  let i = 0

  while (i < src.length) {
    const c = src[i]

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }

    if ((c >= '0' && c <= '9') || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      // scientific notation: 1e-3
      if (/[eE]/.test(src[j] ?? '') && /[0-9+-]/.test(src[j + 1] ?? '')) {
        j += 2
        while (j < src.length && /[0-9]/.test(src[j])) j++
      }
      const raw = src.slice(i, j)
      const v = Number(raw)
      if (!Number.isFinite(v)) throw new ExprError(`"${raw}" is not a number`)
      out.push({ t: 'num', v })
      i = j
      continue
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      out.push({ t: 'name', v: src.slice(i, j) })
      i = j
      continue
    }

    if ('+-*/%^(),'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }

    // Tolerate the typographic characters that turn up in copied formulas.
    if (c === '−') {
      out.push({ t: 'op', v: '-' })
      i++
      continue
    }
    if (c === '×' || c === '·') {
      out.push({ t: 'op', v: '*' })
      i++
      continue
    }
    if (c === '÷') {
      out.push({ t: 'op', v: '/' })
      i++
      continue
    }

    throw new ExprError(`unexpected character "${c}"`)
  }

  return out
}

/* ------------------------------------------------------------------ *
 * Parser / evaluator
 * ------------------------------------------------------------------ */

class Parser {
  private pos = 0
  private readonly tokens: Token[]
  private readonly scope: Record<string, number>

  constructor(tokens: Token[], scope: Record<string, number>) {
    this.tokens = tokens
    this.scope = scope
  }

  evaluate(): number {
    const v = this.parseExpr()
    if (this.pos < this.tokens.length) {
      throw new ExprError('unexpected trailing input')
    }
    return v
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private eatOp(...ops: string[]): string | null {
    const tok = this.peek()
    if (tok && tok.t === 'op' && ops.includes(tok.v)) {
      this.pos++
      return tok.v
    }
    return null
  }

  private parseExpr(): number {
    let left = this.parseTerm()
    for (;;) {
      const op = this.eatOp('+', '-')
      if (!op) return left
      const right = this.parseTerm()
      left = op === '+' ? left + right : left - right
    }
  }

  private parseTerm(): number {
    let left = this.parseUnary()
    for (;;) {
      const op = this.eatOp('*', '/', '%')
      if (!op) return left
      const right = this.parseUnary()
      if (op === '*') left = left * right
      else if (op === '/') left = left / right
      else left = left % right
    }
  }

  private parseUnary(): number {
    const op = this.eatOp('-', '+')
    if (op) {
      const v = this.parseUnary()
      return op === '-' ? -v : v
    }
    return this.parsePower()
  }

  private parsePower(): number {
    const base = this.parsePrimary()
    if (this.eatOp('^')) {
      // right associative, and binds tighter than unary minus on its right
      const exp = this.parseUnary()
      return Math.pow(base, exp)
    }
    return base
  }

  private parsePrimary(): number {
    const tok = this.peek()
    if (!tok) throw new ExprError('unexpected end of expression')

    if (tok.t === 'num') {
      this.pos++
      return tok.v
    }

    if (tok.t === 'name') {
      this.pos++
      const name = tok.v

      if (this.eatOp('(')) {
        const args: number[] = []
        if (!this.eatOp(')')) {
          for (;;) {
            args.push(this.parseExpr())
            if (this.eatOp(',')) continue
            if (this.eatOp(')')) break
            throw new ExprError(`expected "," or ")" in call to ${name}()`)
          }
        }
        const fn = FUNCTIONS[name]
        if (!fn) throw new ExprError(`unknown function "${name}()"`)
        return fn(...args)
      }

      if (name in this.scope) return this.scope[name]
      if (name in CONSTANTS) return CONSTANTS[name]
      throw new ExprError(`unknown variable "${name}"`)
    }

    if (tok.t === 'op' && tok.v === '(') {
      this.pos++
      const v = this.parseExpr()
      if (!this.eatOp(')')) throw new ExprError('missing ")"')
      return v
    }

    throw new ExprError(`unexpected "${tok.v}"`)
  }
}

/**
 * Evaluate `source` against `scope`. Throws ExprError with a message safe to
 * show the user — pack authors need to see what went wrong in their file.
 */
export function evaluate(source: string, scope: Record<string, number> = {}): number {
  const result = new Parser(tokenise(source), scope).evaluate()
  if (!Number.isFinite(result)) {
    throw new ExprError(`"${source}" evaluated to ${result}`)
  }
  return result
}

/** True when `source` parses and evaluates cleanly. Used by pack validation. */
export function isEvaluable(source: string, scope: Record<string, number> = {}): boolean {
  try {
    evaluate(source, scope)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Interpolation
 * ------------------------------------------------------------------ */

/** Trim trailing zeros from a fixed-decimal string: 0.4200 -> 0.42 */
function tidy(n: number): string {
  if (Number.isInteger(n)) return String(n)
  // Guard against 0.30000000000000004 without over-rounding real precision.
  const rounded = Math.round(n * 1e10) / 1e10
  return String(rounded)
}

export function formatNumber(n: number, decimals?: number): string {
  if (decimals === undefined) return tidy(n)
  return n.toFixed(decimals)
}

/**
 * Replace every {{ expression }} in `text` with its evaluated value.
 *
 * The braces may hold a bare variable ({{r}}), an expression ({{1 - r}}), or
 * an expression with a display precision ({{2*r*(1-r) | 3}}).
 *
 * An expression that fails is left visible as `⟨error⟩` rather than throwing,
 * so one bad step never blanks the whole question.
 */
export function interpolate(text: string, scope: Record<string, number>): string {
  return text.replace(/\{\{([^}]*)\}\}/g, (_match, body: string) => {
    const [exprPart, decimalPart] = body.split('|')
    const src = exprPart.trim()
    if (!src) return ''
    try {
      const value = evaluate(src, scope)
      const decimals = decimalPart !== undefined ? Number(decimalPart.trim()) : undefined
      return formatNumber(value, Number.isFinite(decimals) ? decimals : undefined)
    } catch {
      return '⟨error⟩'
    }
  })
}

/** Every {{ … }} expression found in a string, for validation. */
export function extractExpressions(text: string): string[] {
  const out: string[] = []
  const re = /\{\{([^}]*)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const src = m[1].split('|')[0].trim()
    if (src) out.push(src)
  }
  return out
}
