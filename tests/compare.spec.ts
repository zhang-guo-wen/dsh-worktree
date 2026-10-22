/**
 * The line comparison behind the backup page's two-column view.
 *
 * The cases pin what the view depends on: a replacement pairs its two lines so
 * the columns stay aligned, a deletion and a creation keep their one-sided rows,
 * line-ending-only differences do not report as changes, and a large file keeps
 * its changes visible even after unchanged runs collapse and the row limit cuts.
 */

import { describe, expect, it } from 'vitest'
import { COMPARISON_LIMITS, compareTexts } from '../src/compare.ts'

describe('comparing two texts', () => {
  it('pairs a replaced line on both sides and numbers each side', () => {
    const comparison = compareTexts('a\nb\nc\n', 'a\nB\nc\n')

    expect(comparison.rows).toEqual([
      { kind: 'context', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } },
      { kind: 'change', left: { no: 2, text: 'b' }, right: { no: 2, text: 'B' } },
      { kind: 'context', left: { no: 3, text: 'c' }, right: { no: 3, text: 'c' } },
    ])
    expect(comparison).toMatchObject({ added: 1, deleted: 1, truncated: false, coarse: false })
  })

  it('shows a deletion on the left and a creation on the right', () => {
    const deleted = compareTexts('a\nb\n', null)
    expect(deleted.rows).toEqual([
      { kind: 'change', left: { no: 1, text: 'a' } },
      { kind: 'change', left: { no: 2, text: 'b' } },
    ])
    expect(deleted).toMatchObject({ added: 0, deleted: 2 })

    const created = compareTexts(null, 'a\nb\n')
    expect(created.rows).toEqual([
      { kind: 'change', right: { no: 1, text: 'a' } },
      { kind: 'change', right: { no: 2, text: 'b' } },
    ])
    expect(created).toMatchObject({ added: 2, deleted: 0 })
  })

  it('pairs an inserted line with a hole, and moves only the numbers after it', () => {
    const comparison = compareTexts('a\nc\n', 'a\nb\nc\n')

    expect(comparison.rows).toEqual([
      { kind: 'context', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } },
      { kind: 'change', right: { no: 2, text: 'b' } },
      { kind: 'context', left: { no: 2, text: 'c' }, right: { no: 3, text: 'c' } },
    ])
    expect(comparison).toMatchObject({ added: 1, deleted: 0 })
  })

  it('treats a CRLF file and an LF file as unchanged', () => {
    expect(compareTexts('a\r\nb\r\n', 'a\nb\n')).toMatchObject({ rows: [], added: 0, deleted: 0 })
  })

  it('ignores a final-newline difference', () => {
    expect(compareTexts('a\nb', 'a\nb\n')).toMatchObject({ rows: [], added: 0, deleted: 0 })
  })

  it('compares nothing when both sides are empty or identical', () => {
    expect(compareTexts(null, null)).toMatchObject({ rows: [], added: 0, deleted: 0 })
    expect(compareTexts('same\n', 'same\n')).toMatchObject({ rows: [], added: 0, deleted: 0 })
  })

  it('keeps a small file whole, context included', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index}\n`)
    const changed = [...lines]
    changed[20] = 'changed\n'
    const comparison = compareTexts(lines.join(''), changed.join(''))

    expect(comparison.rows).toHaveLength(40)
    expect(comparison.rows.filter(row => row.kind === 'change')).toHaveLength(1)
    expect(comparison.rows.some(row => row.kind === 'gap')).toBe(false)
  })

  it('collapses a long unchanged run and still keeps the change', () => {
    const lines = Array.from({ length: COMPARISON_LIMITS.fullViewRows + 100 }, (_, index) => `line ${index}\n`)
    const changed = [...lines]
    changed[900] = 'CHANGED\n'
    const comparison = compareTexts(lines.join(''), changed.join(''))

    const gap = comparison.rows.find(row => row.kind === 'gap')
    expect(gap).toBeDefined()
    expect(gap?.kind === 'gap' ? gap.hidden : 0).toBeGreaterThan(0)
    expect(comparison.rows.some(row => row.kind === 'change')).toBe(true)
    expect(comparison.rows.length).toBeLessThan(COMPARISON_LIMITS.fullViewRows)
  })

  it('cuts at the row limit and says so when the file is too large to draw whole', () => {
    const before = Array.from({ length: COMPARISON_LIMITS.maxRows + 600 }, (_, index) => `line ${index}\n`)
    const after = before.map((line, index) => (index % 2 === 0 ? line : `changed ${index}\n`))
    const comparison = compareTexts(before.join(''), after.join(''))

    expect(comparison.truncated).toBe(true)
    expect(comparison.rows).toHaveLength(COMPARISON_LIMITS.maxRows)
  })
})
