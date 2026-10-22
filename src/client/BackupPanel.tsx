/**
 * The change-history page's body: one row per file this session's guard copied
 * before changing it, the control that puts one copy back, and the two-column
 * comparison opened from a row.
 *
 * The list is flat on purpose. The copies mirror the workspace's own tree, but
 * the question this page answers is "which files changed", and a reader
 * scanning for the file the AI just broke goes by name — so the row carries the
 * path that identifies it and nothing nests. That also keeps a restore's meaning
 * obvious: one row, one file, one button.
 *
 * Opening a row replaces the list with that file's comparison and a way back:
 * two columns need width, and the pane the list lives in has more of it to give
 * a single comparison than a row can spare.
 *
 * Nothing here subscribes to anything. The list is read when the page mounts
 * and when the reader refreshes it, and a restore's outcome is this body's own
 * state, because no other surface shows it: the row keeps saying "restored"
 * until the next read, instead of vanishing the moment the copy lands, which
 * would leave the click that just succeeded looking like it did nothing.
 * @module @guowenzhang/dsh-worktree/client/BackupPanel
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the right Sidebar's tab seat and its `useTabInfo` hook.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { BackupComparison, BackupEntry, BackupListResult, RestoreResult, RouteResult } from './api.ts'
import type { WorktreeCopyKey } from './locales.ts'
import { BackupDetail } from './BackupDetail.tsx'
import css from './BackupPanel.module.css'

/** Rows drawn while the first read is in flight. */
const SKELETON_ROWS = 3

/**
 * The page's data face, closed over the plugin's route client.
 *
 * Both calls answer with the route's own result union rather than throwing: a
 * refusal carries the Host's text, which is what the page shows in place.
 */
export interface BackupPanelInjected {
  /**
   * Read the session's changed and deleted files.
   * @param sessionId - the session whose copies to list.
   * @returns the entries, or the Host's refusal.
   */
  list: (sessionId: string) => Promise<RouteResult<BackupListResult>>
  /**
   * Write one copy back over its file.
   * @param sessionId - the session holding the copy.
   * @param relative - the copy's path below the session's backup directory.
   * @returns the path written, or the Host's refusal.
   */
  restore: (sessionId: string, relative: string) => Promise<RouteResult<RestoreResult>>
  /**
   * Read one copy's line-by-line comparison with the file it stands for.
   * @param sessionId - the session holding the copy.
   * @param relative - the copy's path below the session's backup directory.
   * @returns the comparison, or the Host's refusal.
   */
  compare: (sessionId: string, relative: string) => Promise<RouteResult<BackupComparison>>
}

/** Full component props. */
export type BackupPanelProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<BackupPanelInjected>
  & PropsLocale<'worktree'>

/** What the page currently has to show. */
interface PanelState {
  /** `loading` also covers a refresh over content already on screen. */
  readonly status: 'loading' | 'ready' | 'failed'
  /** The last successful read; kept across a refresh and a failure. */
  readonly entries: readonly BackupEntry[]
  /** The failure the last read reported, when it had one. */
  readonly message?: string
}

/** One row's own outcome, which outlives the read that listed it. */
type RowState =
  | { readonly kind: 'restoring' }
  | { readonly kind: 'restored' }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Render the file-backup page.
 * @param props - the seat's runtime shares, this plugin's copy, and the data face.
 * @returns the page.
 */
export function BackupPanel({ useTabInfo, sessionId, list, restore, compare, t }: BackupPanelProps): ReactNode {
  const { tab } = useTabInfo()
  const [state, setState] = useState<PanelState>({ status: 'loading', entries: [] })
  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({})
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<BackupEntry | undefined>(undefined)
  const [detailRevision, setDetailRevision] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true }, [])
  useEffect(() => () => { alive.current = false }, [])
  const reload = useCallback(() => { setRevision(value => value + 1) }, [])
  // The read is keyed on the session and the revision the reader asked for.
  // `list` is one value for the plugin's lifetime (the registration hands the
  // same face to every render), so it never re-runs the read on its own.
  useEffect(() => {
    let active = true
    setState(current => ({ ...current, status: 'loading' }))
    void list(sessionId).then(result => {
      if (!active) return
      setState(result.ok
        ? { status: 'ready', entries: result.value.entries }
        : { status: 'failed', entries: [], message: result.message })
    })
    return () => { active = false }
  }, [list, sessionId, revision])
  // The page supports the sidebar's own refresh command, so the shortcut that
  // refreshes every other page does the same thing here — for whichever view is
  // on screen, the list or one file's comparison.
  const refresh = useCallback(() => {
    if (selected === undefined) setRevision(value => value + 1)
    else setDetailRevision(value => value + 1)
  }, [selected])
  useEffect(() => tab.actions.bindCommands({ refresh }), [tab.actions, refresh])

  const onRestore = (entry: BackupEntry): void => {
    setRows(current => ({ ...current, [entry.relative]: { kind: 'restoring' } }))
    void restore(sessionId, entry.relative).then(result => {
      if (!alive.current) return
      const next: RowState = result.ok
        ? { kind: 'restored' }
        : { kind: 'failed', message: result.message }
      setRows(current => ({ ...current, [entry.relative]: next }))
    })
  }

  const onOpen = (entry: BackupEntry): void => {
    setDetailRevision(value => value + 1)
    setSelected(entry)
  }

  if (selected !== undefined) {
    return (
      <BackupDetail
        sessionId={sessionId}
        entry={selected}
        revision={detailRevision}
        onBack={() => { setSelected(undefined) }}
        onRestored={() => {
          setRows(current => ({ ...current, [selected.relative]: { kind: 'restored' } }))
          setDetailRevision(value => value + 1)
        }}
        compare={compare}
        restore={restore}
        t={t}
      />
    )
  }

  const busy = state.status === 'loading'
  return (
    <div className={css.page} data-backup-page="true">
      <div className={css.toolbar}>
        <span className={css.count} role="status" data-backup-count={state.entries.length}>
          {busy && state.entries.length === 0
            ? t('sidebar.loading')
            : t('sidebar.count', { count: String(state.entries.length) })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutlineRegular />}
          aria-label={t('sidebar.refresh')}
          title={t('sidebar.refresh')}
          disabled={busy}
          onClick={reload}
        />
      </div>
      {state.status === 'failed' ? (
        <div className={css.notice} role="status" data-backup-state="failed">
          <p className={css.failed}>{t('sidebar.failed', { message: state.message ?? '' })}</p>
          <Button variant="outline" size="sm" className={css.action} onClick={reload}>{t('sidebar.retry')}</Button>
        </div>
      ) : null}
      {state.entries.length > 0 ? (
        <ul className={css.list} data-backup-state="ready" aria-busy={busy}>
          {state.entries.map(entry => (
            <Row
              key={entry.relative}
              entry={entry}
              row={rows[entry.relative]}
              onRestore={onRestore}
              onOpen={onOpen}
              t={t}
            />
          ))}
        </ul>
      ) : state.status === 'loading' ? (
        <ul className={css.list} data-backup-state="loading" aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li key={index} className={css.row}><span className={css.skeleton} /></li>
          ))}
        </ul>
      ) : state.status === 'ready' ? (
        <p className={css.empty} data-backup-state="empty">{t('sidebar.empty')}</p>
      ) : null}
    </div>
  )
}

/**
 * One file's row: what it is, how it differs, and the controls that open its
 * comparison or put its copy back.
 * @param props - the entry, the row's own outcome, the row actions, and copy.
 * @returns the row.
 */
function Row({ entry, row, onRestore, onOpen, t }: {
  entry: BackupEntry
  row: RowState | undefined
  onRestore: (entry: BackupEntry) => void
  onOpen: (entry: BackupEntry) => void
  t: (key: WorktreeCopyKey, params?: Record<string, string>) => string
}): ReactNode {
  // Three visible states, not a greyed button: a restore that is running, one
  // that landed, and one that failed each say so where the reader clicked.
  const label = row?.kind === 'restoring' ? t('sidebar.restoring')
    : row?.kind === 'restored' ? t('sidebar.restored')
      : t('sidebar.restore')
  return (
    <li className={css.row} data-backup-row={entry.relative} data-backup-file={entry.state}>
      <button
        type="button"
        className={css.open}
        aria-label={t('sidebar.openDiff', { name: entry.name })}
        title={t('sidebar.copyAt', { path: entry.backup })}
        onClick={() => { onOpen(entry) }}
      >
        <span className={css.name}>
          {entry.state === 'deleted' && row?.kind !== 'restored'
            ? <s aria-label={`${entry.name} (${t('sidebar.state.deleted')})`}>{entry.name}</s>
            : entry.name}
        </span>
        {row?.kind === 'failed' ? (
          <span className={css.failed}>{t('sidebar.restoreFailed', { message: row.message })}</span>
        ) : null}
      </button>
      <Button
        variant="outline"
        size="sm"
        className={css.action}
        disabled={row?.kind === 'restoring' || row?.kind === 'restored'}
        aria-label={t('sidebar.restoreOne', { name: entry.name })}
        onClick={() => { onRestore(entry) }}
      >
        {label}
      </Button>
    </li>
  )
}
