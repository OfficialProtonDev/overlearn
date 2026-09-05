/**
 * A deliberately small text renderer for pack prose.
 *
 * Summaries and explanations are written by the ingestion skill, so they need
 * a little formatting — emphasis, inline code for symbols and identifiers,
 * bullets, and line breaks. They do not need full markdown, and they must
 * never be able to inject markup, so this parses a fixed subset into React
 * elements rather than setting innerHTML.
 *
 * Supported:  **bold**   *italic*   `code`   - bullets   blank-line paragraphs
 */

import { Fragment, type ReactNode } from 'react'

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== '')

  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

interface Block {
  kind: 'p' | 'ul'
  lines: string[]
}

function toBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trimEnd()

    if (line.trim() === '') {
      current = null
      continue
    }

    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line)

    if (bullet) {
      if (!current || current.kind !== 'ul') {
        current = { kind: 'ul', lines: [] }
        blocks.push(current)
      }
      current.lines.push(bullet[1])
    } else {
      if (!current || current.kind !== 'p') {
        current = { kind: 'p', lines: [] }
        blocks.push(current)
      }
      current.lines.push(line.trim())
    }
  }

  return blocks
}

interface MarkishProps {
  children: string | undefined
  className?: string
}

export function Markish({ children, className }: MarkishProps) {
  if (!children || !children.trim()) return null

  const blocks = toBlocks(children)

  return (
    <div className={className}>
      {blocks.map((block, i) =>
        block.kind === 'ul' ? (
          <ul key={i} className="markish-list">
            {block.lines.map((line, j) => (
              <li key={j}>{renderInline(line, `${i}-${j}`)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="markish-p">
            {renderInline(block.lines.join(' '), String(i))}
          </p>
        ),
      )}
    </div>
  )
}

/** Single-line variant for prompts, which never contain block structure. */
export function MarkishLine({ children }: { children: string }) {
  return <>{renderInline(children, 'line')}</>
}
