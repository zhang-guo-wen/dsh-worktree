/**
 * One protected file's two-column comparison: the copy from before the session
 * changed the file on the left, the file as it is now on the right.
 *
 * The two panes draw the same rows and scroll vertically together, so a changed
 * line always sits opposite the line it replaced. Horizontal scrolling stays
 * per pane: the sides can have different line lengths, and tying them together
 * would make a long line on one side hide content on the other. Each pane is its
 * own scroll container with fixed-height rows, which is what keeps the columns
 * aligned without measuring anything.
 *
 * The comparison is read once when this view opens (and again after a restore or
 * an explicit refresh); the page owns the list, this view owns only one file.
 * @module @guowenzhang/dsh-worktree/client/BackupDetail
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type UIEvent } from 'react'
import { Button, IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BackupComparison, BackupEntry, RestoreResult, RouteResult } from './api.ts'
import type { WorktreeCopyKey } from './locales.ts'
import { firstChangeRow, toColumns, type ColumnCell, type ComparisonColumns } from './diff-columns.ts'
import css from './BackupDetail.module.css'

/** One comparison read's outcome. */
type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: BackupComparison }
  | { readonly status: 'failed'; readonly message: string }

/** The header control's own outcome, which outlives the read that opened the view. */
type RestoreState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'restoring' }
  | { readonly kind: 'restored' }
  | { readonly kind: 'failed'; readonly message: string }

/** This view's copy reader. */
type Copy = (key: WorktreeCopyKey, params?: Record<string, string>) => string

/** Everything the page hands this view. */
export interface BackupDetailProps {
  /** The session whose copy is compared. */
  readonly sessionId: string
  /** The listed copy this view was opened for. */
  readonly entry: BackupEntry
  /** Bumped by the page to make this view read again (refresh, restore). */
  readonly revision: number
  /** Returns to the file list. */
  readonly onBack: () => void
  /** Called after a successful restore, so the page can re-read this view. */
  readonly onRestored: () => void
  /**
   * Read one comparison from the Host.
   * @param sessionId - the session holding the copy.
   * @param relative - the copy's path below the session's backup directory.
   * @returns the comparison, or the Host's refusal.
   */
  readonly compare: (sessionId: string, relative: string) => Promise<RouteResult<BackupComparison>>
  /**
   * Write one copy back over its file.
   * @param sessionId - the session holding the copy.
   * @param relative - the copy's path below the session's backup directory.
   * @returns the path written, or the Host's refusal.
   */
  readonly restore: (sessionId: string, relative: string) => Promise<RouteResult<RestoreResult>>
  /** This plugin's copy. */
  readonly t: Copy
}

/**
 * Render one copy's comparison.
 * @param props - see {@link BackupDetailProps}.
 * @returns the page body.
 */
export function BackupDetail({ sessionId, entry, revision, onBack, onRestored, compare, restore, t }: BackupDetailProps): ReactNode {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<RestoreState>({ kind: 'idle' })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    void compare(sessionId, entry.relative).then(result => {
      if (!active) return
      setState(result.ok
        ? { status: 'ready', value: result.value }
        : { status: 'failed', message: result.message })
    })
    return () => { active = false }
  }, [compare, sessionId, entry.relative, revision, attempt])

  const onRestore = useCallback(() => {
    setOutcome({ kind: 'restoring' })
    void restore(sessionId, entry.relative).then(result => {
      if (!alive.current) return
      if (result.ok) {
        setOutcome({ kind: 'restored' })
        onRestored()
      } else {
        setOutcome({ kind: 'failed', message: result.message })
      }
    })
  }, [entry.relative, onRestored, restore, sessionId])

  const restoreLabel = outcome.kind === 'restoring' ? t('sidebar.restoring')
    : outcome.kind === 'restored' ? t('sidebar.restored')
      : t('sidebar.restore')

  return (
    <div className={css.page} data-backup-detail={entry.relative}>
      <div className={css.header}>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconChevronLeftOutlineRegular />}
          aria-label={t('sidebar.back')}
          title={t('sidebar.back')}
          onClick={onBack}
        />
        <span className={css.title} title={entry.name}>{entry.name}</span>
        <Button
          variant="outline"
          size="sm"
          className={css.restore}
          disabled={outcome.kind === 'restoring' || outcome.kind === 'restored'}
          aria-label={t('sidebar.restoreOne', { name: entry.name })}
          onClick={onRestore}
        >
          {restoreLabel}
        </Button>
      </div>
      {outcome.kind === 'failed' ? (
        <p className={css.failed} role="status">{t('sidebar.restoreFailed', { message: outcome.message })}</p>
      ) : null}
      {state.status === 'loading' ? <p className={css.notice} role="status">{t('diff.loading')}</p> : null}
      {state.status === 'failed' ? (
        <div className={css.notice}>
          <p className={css.failed}>{t('diff.failed', { message: state.message })}</p>
          <Button variant="outline" size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('sidebar.retry')}</Button>
        </div>
      ) : null}
      {state.status === 'ready' ? <ComparisonView value={state.value} t={t} /> : null}
    </div>
  )
}

/**
 * Render one comparison's body: the notes that explain its shape, then the two
 * panes when there is line content to draw.
 * @param props.value - the comparison.
 * @param props.t - this plugin's copy.
 * @returns the body.
 */
function ComparisonView({ value, t }: { readonly value: BackupComparison; readonly t: Copy }): ReactNode {
  const comparison = value.kind === 'text' ? value.comparison : undefined
  const rows = comparison?.rows ?? []
  const columns = useMemo(() => toColumns(rows), [rows])
  const firstChange = useMemo(() => firstChangeRow(rows), [rows])
  if (value.kind !== 'text') {
    const message = value.kind === 'unreadable'
      ? t('diff.unreadable')
      : t(value.kind === 'binary' ? 'diff.binary' : 'diff.oversized', {
        before: sizeText(value.beforeBytes, t),
        after: sizeText(value.afterBytes, t),
      })
    return <p className={css.notice} role="status">{message}</p>
  }
  if (comparison === undefined || rows.length === 0) {
    return (
      <>
        {value.state === 'deleted' ? <p className={css.note}>{t('diff.deleted')}</p> : null}
        <p className={css.notice} role="status">{t('diff.identical')}</p>
      </>
    )
  }
  return (
    <>
      {value.state === 'deleted' ? <p className={css.note}>{t('diff.deleted')}</p> : null}
      {comparison.truncated ? <p className={css.note} role="status">{t('diff.truncated', { count: String(rows.length) })}</p> : null}
      {comparison.coarse ? <p className={css.note} role="status">{t('diff.coarse')}</p> : null}
      <SplitComparison columns={columns} firstChange={firstChange} t={t} />
    </>
  )
}

/**
 * Draw the two aligned panes and keep their vertical scrolls in step.
 * @param props.columns - the two columns.
 * @param props.firstChange - row index the panes scroll to when they open.
 * @param props.t - this plugin's copy.
 * @returns the panes.
 */
function SplitComparison({ columns, firstChange, t }: {
  readonly columns: ComparisonColumns
  readonly firstChange: number
  readonly t: Copy
}): ReactNode {
  const leftPane = useRef<HTMLDivElement>(null)
  const rightPane = useRef<HTMLDivElement>(null)
  // Opening on the first change is the whole point of the view: a 2,000-line
  // context would otherwise put the difference below the fold.
  useEffect(() => {
    const pane = leftPane.current
    if (pane === null || firstChange < 0) return
    const target = pane.querySelector<HTMLElement>(`[data-row="${firstChange}"]`)
    if (target === null) return
    pane.scrollTop = Math.max(0, target.offsetTop - Math.round(pane.clientHeight / 2))
    if (rightPane.current !== null) rightPane.current.scrollTop = pane.scrollTop
  }, [columns, firstChange])
  // Setting the peer's scrollTop fires its own scroll event; that handler then
  // finds the two already equal and stops, so there is no feedback loop.
  const mirror = (from: 'left' | 'right') => (): void => {
    const source = from === 'left' ? leftPane.current : rightPane.current
    const target = from === 'left' ? rightPane.current : leftPane.current
    if (source === null || target === null) return
    if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop
  }
  return (
    <>
      <div className={css.columnHeaders} aria-hidden="true">
        <span>{t('diff.before')}</span>
        <span>{t('diff.after')}</span>
      </div>
      <div className={css.columns} data-backup-columns="">
        <Pane side="left" cells={columns.left} paneRef={leftPane} onScroll={mirror('left')} label={t('diff.before')} t={t} />
        <Pane side="right" cells={columns.right} paneRef={rightPane} onScroll={mirror('right')} label={t('diff.after')} t={t} />
      </div>
    </>
  )
}

/**
 * One scrollable column.
 * @param props.side - which side this is, for test hooks and the sync direction.
 * @param props.cells - the column's cells.
 * @param props.paneRef - the scroll container, shared with the sibling pane.
 * @param props.onScroll - keeps the peer's vertical offset equal.
 * @param props.label - the column's accessible name.
 * @param props.t - this plugin's copy.
 * @returns the pane.
 */
function Pane({ side, cells, paneRef, onScroll, label, t }: {
  readonly side: 'left' | 'right'
  readonly cells: readonly ColumnCell[]
  readonly paneRef: RefObject<HTMLDivElement>
  readonly onScroll: (event: UIEvent<HTMLDivElement>) => void
  readonly label: string
  readonly t: Copy
}): ReactNode {
  return (
    <div
      className={css.pane}
      ref={paneRef}
      onScroll={onScroll}
      tabIndex={0}
      role="region"
      aria-label={label}
      data-diff-side={side}
    >
      <div className={css.rows}>
        {cells.map((cell, index) => <Cell key={index} cell={cell} index={index} t={t} />)}
      </div>
    </div>
  )
}

/**
 * One row of one column.
 * @param props.cell - what the cell draws.
 * @param props.index - the row's index, so the open scroll can find a change.
 * @param props.t - this plugin's copy.
 * @returns the row.
 */
function Cell({ cell, index, t }: { readonly cell: ColumnCell; readonly index: number; readonly t: Copy }): ReactNode {
  if (cell.kind === 'empty') return <div className={css.row} data-row={index} data-cell="empty" aria-hidden="true" />
  if (cell.kind === 'gap') {
    return (
      <div className={css.row} data-row={index} data-cell="gap">
        <span className={css.gap}>{cell.hidden === undefined ? '⋯' : t('diff.gap', { count: String(cell.hidden) })}</span>
      </div>
    )
  }
  return (
    <div className={css.row} data-row={index} data-cell={cell.kind}>
      <span className={css.no}>{cell.no ?? ''}</span>
      <span className={css.text}>{cell.text ?? ''}</span>
    </div>
  )
}

/**
 * Format one side's byte size for the not-readable notes.
 * @param bytes - the side's size.
 * @param t - this plugin's copy.
 * @returns the localized size.
 */
function sizeText(bytes: number, t: Copy): string {
  if (bytes >= 1024 * 1024) return t('diff.size.mb', { value: (bytes / (1024 * 1024)).toFixed(1) })
  if (bytes >= 1024) return t('diff.size.kb', { value: (bytes / 1024).toFixed(1) })
  return t('diff.size.b', { value: String(bytes) })
}
