/**
 * The comparison values both halves of this plugin agree on.
 *
 * The Host builds a comparison from two texts it already has on disk — the
 * backup copy taken before the session first changed a file, and the file as it
 * is now — and the browser renders it as two aligned columns. Keeping the value
 * declarations in one import-free module is what lets the browser bundle use
 * them without pulling the diff engine into the page.
 * @module @guowenzhang/dsh-worktree/comparison-types
 */

/** One line of one side of a comparison. */
export interface ComparisonLine {
  /** The line's number on its own side, counting from 1. */
  readonly no: number
  /** The line's text, without its terminator. */
  readonly text: string
}

/**
 * One row of the two-column view.
 *
 * A context row is an unchanged line and draws on both sides. A change row
 * holds a deleted line, an added one, or a paired replacement — the pairing is
 * what keeps the columns aligned. A gap row stands for an unchanged run the
 * view collapsed instead of drawing.
 */
export type ComparisonRow =
  | { readonly kind: 'context'; readonly left: ComparisonLine; readonly right: ComparisonLine }
  | { readonly kind: 'change'; readonly left?: ComparisonLine; readonly right?: ComparisonLine }
  | { readonly kind: 'gap'; readonly hidden: number }

/** One comparison, as the Host computes it. */
export interface Comparison {
  /** The rows, in file order. */
  readonly rows: readonly ComparisonRow[]
  /** Lines the current file added. */
  readonly added: number
  /** Lines the current file deleted. */
  readonly deleted: number
  /** Whether the row limit cut the view. */
  readonly truncated: boolean
  /** Whether the line diff exceeded its bound and fell back to whole-block replacement. */
  readonly coarse: boolean
}

/**
 * What the Host could make of a protected file's two sides.
 *
 * `text` carries a comparison; every other kind carries only the byte sizes,
 * because nothing on either side can be shown line by line.
 */
export type ComparisonKind = 'text' | 'binary' | 'oversized' | 'unreadable'
