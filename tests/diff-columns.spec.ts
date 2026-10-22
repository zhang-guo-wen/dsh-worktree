/**
 * The two-column view model: one row becomes one cell per column.
 *
 * The alignment rule lives here — a one-sided row leaves a hole on the other
 * side rather than shifting it — so these cases pin the hole, the paired change,
 * and the gap row's left-only count.
 */

import { describe, expect, it } from 'vitest'
import { firstChangeRow, toColumns } from '../src/client/diff-columns.ts'
import type { ComparisonRow } from '../src/comparison-types.ts'

describe('turning comparison rows into columns', () => {
  it('draws an unchanged row on both sides with its own numbering', () => {
    const { left, right } = toColumns([
      { kind: 'context', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } },
    ])

    expect(left).toEqual([{ kind: 'context', no: 1, text: 'a' }])
    expect(right).toEqual([{ kind: 'context', no: 1, text: 'a' }])
  })

  it('draws a paired replacement as a deletion on the left and an addition on the right', () => {
    const { left, right } = toColumns([
      { kind: 'change', left: { no: 2, text: 'b' }, right: { no: 2, text: 'B' } },
    ])

    expect(left).toEqual([{ kind: 'deleted', no: 2, text: 'b' }])
    expect(right).toEqual([{ kind: 'added', no: 2, text: 'B' }])
  })

  it('leaves a hole opposite a one-sided line', () => {
    const { left, right } = toColumns([
      { kind: 'change', left: { no: 3, text: 'gone' } },
      { kind: 'change', right: { no: 4, text: 'new' } },
    ])

    expect(left).toEqual([{ kind: 'deleted', no: 3, text: 'gone' }, { kind: 'empty' }])
    expect(right).toEqual([{ kind: 'empty' }, { kind: 'added', no: 4, text: 'new' }])
  })

  it('puts the hidden count on the left column only, and keeps both columns in step', () => {
    const rows: ComparisonRow[] = [
      { kind: 'context', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } },
      { kind: 'gap', hidden: 42 },
      { kind: 'change', left: { no: 50, text: 'b' }, right: { no: 50, text: 'B' } },
    ]
    const { left, right } = toColumns(rows)

    expect(left[1]).toEqual({ kind: 'gap', hidden: 42 })
    expect(right[1]).toEqual({ kind: 'gap' })
    expect(left).toHaveLength(right.length)
  })

  it('reports the first change so the view can open on it, or -1 when nothing changed', () => {
    expect(firstChangeRow([
      { kind: 'gap', hidden: 10 },
      { kind: 'change', right: { no: 12, text: 'x' } },
      { kind: 'change', left: { no: 12, text: 'y' } },
    ])).toBe(1)
    expect(firstChangeRow([{ kind: 'context', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } }])).toBe(-1)
    expect(firstChangeRow([])).toBe(-1)
  })
})
