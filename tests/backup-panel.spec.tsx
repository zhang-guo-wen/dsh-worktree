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
import type { BackupComparison, BackupEntry, BackupListResult, RestoreResult, RouteResult } from '../src/client/api.ts'
import { zh, type WorktreeCopyKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** One listed copy, as the Host reports it. */
function entry(name: string, state: 'modified' | 'deleted'): BackupEntry {
  return { relative: name, path: `/w/${name}`, name, backup: `/guard/${name}`, state }
}

/** One comparison the Host would serve for `src/a.ts`. */
function comparison(): BackupComparison {
  return {
    relative: 'src/a.ts',
    path: '/w/src/a.ts',
    name: 'src/a.ts',
    state: 'modified',
    kind: 'text',
    beforeBytes: 6,
    afterBytes: 6,
    comparison: {
      rows: [
        { kind: 'context', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } },
        { kind: 'change', left: { no: 2, text: 'b' }, right: { no: 2, text: 'B' } },
        { kind: 'context', left: { no: 3, text: 'c' }, right: { no: 3, text: 'c' } },
      ],
      added: 1,
      deleted: 1,
      truncated: false,
      coarse: false,
    },
  }
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
  /** The comparison reads the detail view made, in order. */
  readonly compares: [string, string][]
}

/**
 * Mount the page over stubbed reads.
 * @param stubs.list - answer for one backup read; defaults to an empty list.
 * @param stubs.restore - answer for one restore; defaults to success.
 * @param stubs.compare - answer for one comparison read; defaults to a refusal.
 * @returns the calls the page made.
 */
async function mount(stubs: {
  list?: () => Promise<RouteResult<BackupListResult>>
  restore?: () => Promise<RouteResult<RestoreResult>>
  compare?: () => Promise<RouteResult<BackupComparison>>
} = {}): Promise<Mounted> {
  const reads: string[] = []
  const restores: [string, string][] = []
  const compares: [string, string][] = []
  const face: BackupPanelInjected = {
    list: (sessionId) => {
      reads.push(sessionId)
      return stubs.list?.() ?? Promise.resolve({ ok: true, value: { entries: [] } })
    },
    restore: (sessionId, relative) => {
      restores.push([sessionId, relative])
      return stubs.restore?.() ?? Promise.resolve({ ok: true, value: { path: `/w/${relative}`, bytes: 1 } })
    },
    compare: (sessionId, relative) => {
      compares.push([sessionId, relative])
      return stubs.compare?.() ?? Promise.resolve({ ok: false, message: 'comparison not stubbed' })
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
  return { reads, restores, compares }
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
    expect(screen.queryByText(copy('sidebar.state.deleted'))).toBeNull()
    expect(screen.queryByText(copy('sidebar.state.modified'))).toBeNull()
    expect(screen.getByText('docs/gone.md').tagName).toBe('S')
    expect(screen.getByText('src/a.ts').closest('s')).toBeNull()
    expect(screen.getByRole('button', { name: restoreName('docs/gone.md') })).toBeDefined()
    expect(screen.getByRole('button', { name: restoreName('src/a.ts') })).toBeDefined()
  })

  it('removes the deletion strike after restoring a deleted file', async () => {
    await mount({
      list: async () => ({ ok: true, value: { entries: [entry('gone.md', 'deleted')] } }),
    })
    expect(screen.getByText('gone.md').tagName).toBe('S')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: restoreName('gone.md') })) })
    expect(screen.getByText('gone.md').closest('s')).toBeNull()
    expect(screen.getByText(copy('sidebar.restored'))).toBeDefined()
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

  it('opens one file\'s two-column comparison and returns to the list', async () => {
    const mounted = await mount({
      list: async () => ({ ok: true, value: { entries: [entry('src/a.ts', 'modified')] } }),
      compare: async () => ({ ok: true, value: comparison() }),
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('sidebar.openDiff', { name: 'src/a.ts' }) }))
    })

    expect(mounted.compares).toEqual([['session-1', 'src/a.ts']])
    // Two panes, each named for the side it shows, and the changed line drawn
    // on both of them.
    expect(screen.getByLabelText(copy('diff.before'))).toBeDefined()
    expect(screen.getByLabelText(copy('diff.after'))).toBeDefined()
    expect(await screen.findByText('B')).toBeDefined()
    expect(screen.getByText('b')).toBeDefined()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy('sidebar.back') })) })

    expect(screen.getByText('src/a.ts')).toBeDefined()
    expect(screen.queryByLabelText(copy('diff.before'))).toBeNull()
  })

  it('says a deleted file has no right side instead of drawing an empty column silently', async () => {
    await mount({
      list: async () => ({ ok: true, value: { entries: [entry('src/a.ts', 'deleted')] } }),
      compare: async () => ({
        ok: true,
        value: { ...comparison(), state: 'deleted', afterBytes: 0 },
      }),
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('sidebar.openDiff', { name: 'src/a.ts' }) }))
    })

    expect(await screen.findByText(copy('diff.deleted'))).toBeDefined()
  })

  it('explains a binary file with its sizes instead of drawing columns', async () => {
    await mount({
      list: async () => ({ ok: true, value: { entries: [entry('photo.png', 'modified')] } }),
      compare: async () => ({
        ok: true,
        value: {
          relative: 'photo.png', path: '/w/photo.png', name: 'photo.png', state: 'modified',
          kind: 'binary', beforeBytes: 2048, afterBytes: 4096,
        },
      }),
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('sidebar.openDiff', { name: 'photo.png' }) }))
    })

    expect(await screen.findByText(copy('diff.binary', { before: '2.0 KB', after: '4.0 KB' }))).toBeDefined()
    expect(screen.queryByLabelText(copy('diff.before'))).toBeNull()
  })

  it('reports a refused comparison and re-reads it when the reader retries', async () => {
    let answer: RouteResult<BackupComparison> = { ok: false, message: 'the copy vanished' }
    const mounted = await mount({
      list: async () => ({ ok: true, value: { entries: [entry('src/a.ts', 'modified')] } }),
      compare: async () => answer,
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('sidebar.openDiff', { name: 'src/a.ts' }) }))
    })
    expect(await screen.findByText(copy('diff.failed', { message: 'the copy vanished' }))).toBeDefined()

    answer = { ok: true, value: comparison() }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy('sidebar.retry') })) })

    expect(mounted.compares).toHaveLength(2)
    expect(await screen.findByText('B')).toBeDefined()
  })
})
