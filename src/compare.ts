/**
 * Line comparison for the file-backup page's two-column view.
 *
 * The two sides are texts the Host already has on disk: the copy taken before
 * this session first changed a file, and that file as it is now. No version
 * control participates, so the same answer comes back on a machine without Git.
 *
 * A row holds one line of each side. Deleted lines sit alone on the left, added
 * lines alone on the right, and a replaced block pairs its deletions with its
 * additions row by row so the columns stay aligned. Long unchanged stretches
 * collapse into a single gap row once the whole file would be too expensive to
 * draw, which keeps a large file's changes visible without hiding them behind a
 * cut.
 * @module @guowenzhang/dsh-worktree/compare
 */

import { diffLines } from 'diff'
import type { ChangeObject } from 'diff'
import type { Comparison, ComparisonLine, ComparisonRow } from './comparison-types.ts'

/** Context rows kept on each side of a change when unchanged runs collapse. */
const KEPT_CONTEXT = 3

/** Rows at which the view starts collapsing unchanged runs instead of drawing them. */
const FULL_VIEW_ROWS = 1_200

/** Rows a comparison may carry; a longer one is cut and reported truncated. */
const MAX_ROWS = 2_400

/** Bound on one line comparison; a slower one degrades to a whole-block replacement. */
const DIFF_TIMEOUT_MS = 1_000

/** The bounds the view is built to; exported so tests assert behavior, not magic sizes. */
export const COMPARISON_LIMITS = {
  keptContext: KEPT_CONTEXT,
  fullViewRows: FULL_VIEW_ROWS,
  maxRows: MAX_ROWS,
  timeoutMs: DIFF_TIMEOUT_MS,
} as const

/**
 * Split one side into display lines.
 *
 * A byte-order mark is not content and a carriage return is not a line of its
 * own, so both are dropped here: a CRLF file compares against an LF one without
 * every line reporting as changed. A single trailing newline terminates the last
 * line rather than opening an empty one.
 * @param text - the side's text.
 * @returns its lines, without terminators.
 */
function splitLines(text: string): string[] {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  if (body === '') return []
  const withoutLastTerminator = body.endsWith('\n') ? body.slice(0, -1) : body
  return withoutLastTerminator.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
}

/**
 * Join lines back with one terminator each.
 *
 * Comparing terminated text is what makes the last line compare by content
 * alone: the line-based diff then never reports a final-newline difference as a
 * changed line.
 * @param lines - the side's lines.
 * @returns the text with every line terminated.
 */
function terminate(lines: readonly string[]): string {
  return lines.length === 0 ? '' : lines.map(line => `${line}\n`).join('')
}

/**
 * The lines one change part carries.
 * @param value - the part's text.
 * @returns its lines, without terminators.
 */
function partLines(value: string): string[] {
  if (value === '') return []
  const body = value.endsWith('\n') ? value.slice(0, -1) : value
  return body.split('\n')
}

/**
 * Shape the rows every comparison ends with: collapse unchanged runs when the
 * file is large, then cut at the hard row limit.
 * @param rows - every row of the comparison.
 * @param added - lines the current file added.
 * @param deleted - lines the current file deleted.
 * @param coarse - whether the line diff degraded to a whole-block replacement.
 * @returns the comparison the route serves.
 */
function finish(rows: ComparisonRow[], added: number, deleted: number, coarse: boolean): Comparison {
  const collapsed = rows.length > FULL_VIEW_ROWS ? collapse(rows) : rows
  const truncated = collapsed.length > MAX_ROWS
  return {
    rows: truncated ? collapsed.slice(0, MAX_ROWS) : collapsed,
    added,
    deleted,
    truncated,
    coarse,
  }
}

/**
 * Replace every unchanged run longer than the kept context with one gap row.
 * @param rows - the full row list.
 * @returns the row list with long unchanged runs collapsed.
 */
function collapse(rows: readonly ComparisonRow[]): ComparisonRow[] {
  const kept: ComparisonRow[] = []
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    if (row === undefined || row.kind !== 'context') {
      if (row !== undefined) kept.push(row)
      index += 1
      continue
    }
    let end = index
    while (end < rows.length) {
      const current = rows[end]
      if (current === undefined || current.kind !== 'context') break
      end += 1
    }
    const run = end - index
    if (run > KEPT_CONTEXT * 2) {
      for (let head = 0; head < KEPT_CONTEXT; head += 1) {
        const at = rows[index + head]
        if (at !== undefined) kept.push(at)
      }
      kept.push({ kind: 'gap', hidden: run - KEPT_CONTEXT * 2 })
      for (let tail = end - KEPT_CONTEXT; tail < end; tail += 1) {
        const at = rows[tail]
        if (at !== undefined) kept.push(at)
      }
    } else {
      for (let at = index; at < end; at += 1) {
        const current = rows[at]
        if (current !== undefined) kept.push(current)
      }
    }
    index = end
  }
  return kept
}

/**
 * Build a comparison whose line diff did not finish inside its bound.
 *
 * Pairing the sides row by row keeps the columns aligned and shows both
 * complete texts; the `coarse` flag tells the reader this is a fallback rather
 * than a line-by-line result.
 * @param beforeLines - the old side's lines.
 * @param afterLines - the new side's lines.
 * @returns the whole-block comparison.
 */
function replaceAll(beforeLines: readonly string[], afterLines: readonly string[]): Comparison {
  const rows: ComparisonRow[] = []
  const size = Math.max(beforeLines.length, afterLines.length)
  for (let index = 0; index < size; index += 1) {
    const before = beforeLines[index]
    const after = afterLines[index]
    rows.push({
      kind: 'change',
      ...before === undefined ? {} : { left: { no: index + 1, text: before } },
      ...after === undefined ? {} : { right: { no: index + 1, text: after } },
    })
  }
  return finish(rows, afterLines.length, beforeLines.length, true)
}

/**
 * Build the rows one line diff reports.
 * @param parts - the diff's change parts, in file order.
 * @returns the comparison.
 */
function fromParts(parts: readonly ChangeObject<string>[]): Comparison {
  const rows: ComparisonRow[] = []
  let added = 0
  let deleted = 0
  let oldNo = 1
  let newNo = 1
  for (let at = 0; at < parts.length; at += 1) {
    const part = parts[at]
    if (part === undefined) continue
    if (part.removed === true) {
      const gone = partLines(part.value)
      const next = parts[at + 1]
      const arrived = next?.added === true ? partLines(next.value) : []
      if (next?.added === true) at += 1
      deleted += gone.length
      added += arrived.length
      const size = Math.max(gone.length, arrived.length)
      for (let index = 0; index < size; index += 1) {
        const before = gone[index]
        const after = arrived[index]
        rows.push({
          kind: 'change',
          ...before === undefined ? {} : { left: { no: oldNo + index, text: before } },
          ...after === undefined ? {} : { right: { no: newNo + index, text: after } },
        })
      }
      oldNo += gone.length
      newNo += arrived.length
      continue
    }
    if (part.added === true) {
      const arrived = partLines(part.value)
      added += arrived.length
      for (const text of arrived) {
        rows.push({ kind: 'change', right: { no: newNo, text } })
        newNo += 1
      }
      continue
    }
    for (const text of partLines(part.value)) {
      const left: ComparisonLine = { no: oldNo, text }
      const right: ComparisonLine = { no: newNo, text }
      rows.push({ kind: 'context', left, right })
      oldNo += 1
      newNo += 1
    }
  }
  return finish(rows, added, deleted, false)
}

/**
 * Compare two texts line by line.
 *
 * A null side does not exist (a deleted or a not-yet-existing file) and is
 * treated as empty, so a deletion shows every old line on the left and a
 * creation shows every new line on the right.
 * @param before - the copy's text, or null when there is none.
 * @param after - the current file's text, or null when it is gone.
 * @returns the rows and totals the detail view renders.
 */
export function compareTexts(before: string | null, after: string | null): Comparison {
  const beforeLines = splitLines(before ?? '')
  const afterLines = splitLines(after ?? '')
  const oldText = terminate(beforeLines)
  const newText = terminate(afterLines)
  // Identical content has nothing to show, not a whole file of unchanged rows:
  // the detail view reads an empty row list as "the content matches the copy".
  if (oldText === newText) return { rows: [], added: 0, deleted: 0, truncated: false, coarse: false }
  const parts = diffLines(oldText, newText, { timeout: DIFF_TIMEOUT_MS })
  return parts === undefined ? replaceAll(beforeLines, afterLines) : fromParts(parts)
}
