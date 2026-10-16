// @vitest-environment jsdom
/**
 * The file-backup page's list and its restore control.
 *
 * The page is the only surface that shows what the file guard copied before
 * this session changed a file, so the cases that matter are the ones a reader
 * would notice: the rows are flat and say which file changed and how, a restore
 * is a per-file action with its own running/succeeded/failed state, and a read
 * that fails keeps its reason on screen with a way to try again.
 *
 * The props are fed directly — the seat's `useTabInfo` share is the one stub,
 * because the render machinery that binds it belongs to the sidebar — so these
 * cases assert what the page renders, not how the sidebar drives it.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupPanel, type BackupPanelInjected, type BackupPanelProps } from '../src/client/BackupPanel.tsx'
import type { BackupEntry, BackupListResult, RestoreResult, RouteResult } from '../src/client/api.ts'
import { zh, type WorktreeCopyKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** One listed copy, as the Host reports it. */
function entry(name: string, state: 'modified' | 'deleted'): BackupEntry {
  return { relative: name, path: `/w/${name}`, name, backup: `/guard/${name}`, state }
}

/** This plugin's copy, with the placeholders the page passes filled in. */
function copy(key: WorktreeCopyKey, params: Record<string, string> = {}): string {
  return zh[key].replace(/\{(\w+)\}/gu, (_, name: string) => params[name] ?? '')
}

/** The accessible name of one row's restore control. */
function restoreName(name: string): string {
  return copy('sidebar.restoreOne', { name })
}

/** What one mount exposes to a case. */
interface Mounted {
  /** Session ids the page read the backup list for, in order. */
  readonly reads: string[]
  /** The restore requests the page made, in order. */
  readonly restores: [string, string][]
}

/**
 * Mount the page over stubbed reads.
 * @param stubs.list - answer for one backup read; defaults to an empty list.
 * @param stubs.restore - answer for one restore; defaults to success.
 * @returns the calls the page made.
 */
async function mount(stubs: {
  list?: () => Promise<RouteResult<BackupListResult>>
  restore?: () => Promise<RouteResult<RestoreResult>>
} = {}): Promise<Mounted> {
  const reads: string[] = []
  const restores: [string, string][] = []
  const face: BackupPanelInjected = {
    list: (sessionId) => {
      reads.push(sessionId)
      return stubs.list?.() ?? Promise.resolve({ ok: true, value: { entries: [] } })
    },
    restore: (sessionId, relative) => {
      restores.push([sessionId, relative])
      return stubs.restore?.() ?? Promise.resolve({ ok: true, value: { path: `/w/${relative}`, bytes: 1 } })
    },
  }
  // The seat binds this hook; one stable object keeps the component's effects
  // from re-running on every render, exactly as the real tab occurrence does.
  const actions = { bindCommands: () => () => {} }
  const tabInfo = { tab: { actions } }
  const props = {
    sessionId: 'session-1',
    useTabInfo: () => tabInfo,
    ...face,
    t: (key: WorktreeCopyKey, params?: Record<string, string>) => copy(key, params),
  } as unknown as BackupPanelProps
  await act(async () => { render(<BackupPanel {...props} />) })
  return { reads, restores }
}

describe('the file-backup page', () => {
  it('lists one flat row per changed and deleted file, each with its own restore control', async () => {
    await mount({
      list: async () => ({
        ok: true,
        value: { entries: [entry('docs/gone.md', 'deleted'), entry('src/a.ts', 'modified')] },
      }),
    })

    // Flat: a nested path is a row of its own, exactly like a top-level one.
    const rows = screen.getAllByRole('listitem')
    expect(rows.map(row => row.getAttribute('data-backup-row'))).toEqual(['docs/gone.md', 'src/a.ts'])
    expect(rows.map(row => row.getAttribute('data-backup-file'))).toEqual(['deleted', 'modified'])
    expect(screen.getByText(copy('sidebar.state.deleted'))).toBeDefined()
    expect(screen.getByText(copy('sidebar.state.modified'))).toBeDefined()
    expect(screen.getByRole('button', { name: restoreName('docs/gone.md') })).toBeDefined()
    expect(screen.getByRole('button', { name: restoreName('src/a.ts') })).toBeDefined()
  })

  it('puts one copy back and reports the result on that row alone', async () => {
    let answer: (result: RouteResult<RestoreResult>) => void = () => {}
    const pending = new Promise<RouteResult<RestoreResult>>(resolve => { answer = resolve })
    const mounted = await mount({
      list: async () => ({ ok: true, value: { entries: [entry('src/a.ts', 'modified')] } }),
      restore: () => pending,
    })

    act(() => { fireEvent.click(screen.getByRole('button', { name: restoreName('src/a.ts') })) })
    expect(mounted.restores).toEqual([['session-1', 'src/a.ts']])
    // Running is visible, and the control is inert while it is.
    expect(await screen.findByText(copy('sidebar.restoring'))).toBeDefined()
    expect(screen.getByRole('button', { name: restoreName('src/a.ts') }).hasAttribute('disabled')).toBe(true)

    await act(async () => { answer({ ok: true, value: { path: '/w/src/a.ts', bytes: 3 } }) })
    expect(screen.getByText(copy('sidebar.restored'))).toBeDefined()
  })

  it('reports a refused restore on the row and leaves the control usable', async () => {
    await mount({
      list: async () => ({ ok: true, value: { entries: [entry('src/a.ts', 'modified')] } }),
      restore: async () => ({ ok: false, message: 'no copy at that path' }),
    })

    act(() => { fireEvent.click(screen.getByRole('button', { name: restoreName('src/a.ts') })) })

    expect(await screen.findByText(copy('sidebar.restoreFailed', { message: 'no copy at that path' }))).toBeDefined()
    // A retry is the reader's next move, so the control comes back enabled.
    expect(screen.getByRole('button', { name: restoreName('src/a.ts') }).hasAttribute('disabled')).toBe(false)
  })

  it('keeps a failed read on screen and re-reads when the reader retries', async () => {
    let answer: RouteResult<BackupListResult> = { ok: false, message: 'the route is unreachable' }
    const mounted = await mount({ list: async () => answer })

    expect(screen.getByText(copy('sidebar.failed', { message: 'the route is unreachable' }))).toBeDefined()

    answer = { ok: true, value: { entries: [entry('src/a.ts', 'modified')] } }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy('sidebar.retry') })) })

    expect(mounted.reads).toEqual(['session-1', 'session-1'])
    expect(screen.getByText('src/a.ts')).toBeDefined()
  })

  it('explains an empty list instead of leaving a blank pane', async () => {
    await mount()

    expect(screen.getByText(copy('sidebar.empty'))).toBeDefined()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('keeps the list on screen while a refresh is in flight', async () => {
    let reads = 0
    await mount({
      list: () => {
        reads += 1
        return reads === 1
          ? Promise.resolve({ ok: true, value: { entries: [entry('src/a.ts', 'modified')] } })
          : new Promise(() => {})
      },
    })

    act(() => { fireEvent.click(screen.getByRole('button', { name: copy('sidebar.refresh') })) })

    // The last successful read stays visible and only the control goes inert,
    // so a refresh never blanks the pane or loses the reader's place.
    expect(screen.getByText('src/a.ts')).toBeDefined()
    expect(screen.getByRole('button', { name: copy('sidebar.refresh') }).hasAttribute('disabled')).toBe(true)
    expect(reads).toBe(2)
  })
})
