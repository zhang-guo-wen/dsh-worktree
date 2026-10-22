/**
 * The view model for the backup page's two-column comparison.
 *
 * The Host serves rows, not columns: one row holds the line of each side that
 * belongs on the same visual line. This module turns those rows into the two
 * aligned cell lists the panes draw, which is the only place the alignment rule
 * lives — an empty cell is a hole on one side, never a missing row, so both
 * panes always have the same number of rows and their vertical scrolls agree.
 * @module @guowenzhang/dsh-worktree/client/diff-columns
 */

import type { ComparisonRow } from '../comparison-types.ts'

/** What one cell of one column draws. */
export interface ColumnCell {
  /** `context` — unchanged; `deleted`/`added` — a changed line on its own side; `empty`/`gap` — no line. */
  readonly kind: 'context' | 'deleted' | 'added' | 'empty' | 'gap'
  /** The line's number on this side, absent on an empty or gap cell. */
  readonly no?: number
  /** The line's text, absent on an empty or gap cell. */
  readonly text?: string
  /** Unchanged rows this gap stands for, present only on a gap cell of the left column. */
  readonly hidden?: number
}

/** Both columns, aligned row for row. */
export interface ComparisonColumns {
  /** The backup copy's column: the file as it was before the session changed it. */
  readonly left: readonly ColumnCell[]
  /** The current file's column. */
  readonly right: readonly ColumnCell[]
}

/**
 * Turn the Host's rows into the two aligned columns.
 * @param rows - the comparison's rows, in file order.
 * @returns the columns; both lists have the same length.
 */
export function toColumns(rows: readonly ComparisonRow[]): ComparisonColumns {
  const left: ColumnCell[] = []
  const right: ColumnCell[] = []
  for (const row of rows) {
    switch (row.kind) {
      case 'context':
        left.push({ kind: 'context', no: row.left.no, text: row.left.text })
        right.push({ kind: 'context', no: row.right.no, text: row.right.text })
        break
      case 'change':
        left.push(row.left === undefined ? { kind: 'empty' } : { kind: 'deleted', no: row.left.no, text: row.left.text })
        right.push(row.right === undefined ? { kind: 'empty' } : { kind: 'added', no: row.right.no, text: row.right.text })
        break
      case 'gap':
        // The count belongs on the left column only; the right column draws the
        // same band so both panes keep their row heights in step.
        left.push({ kind: 'gap', hidden: row.hidden })
        right.push({ kind: 'gap' })
        break
    }
  }
  return { left, right }
}

/**
 * The row index of the first change, which is what the detail view scrolls to.
 * @param rows - the comparison's rows.
 * @returns the index, or -1 when nothing changed.
 */
export function firstChangeRow(rows: readonly ComparisonRow[]): number {
  return rows.findIndex(row => row.kind === 'change')
}
