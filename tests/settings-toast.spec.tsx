// @vitest-environment jsdom
/**
 * Where the file backup page reports an action result.
 *
 * Both things this page reports are results — a write the Host refused, and a
 * draft it would reject — and both used to render at the page's own end, below
 * two cards inside the settings dialog's scroll container, where a long page
 * scrolls them out of sight. The case mounts the real page over the real
 * auto-save controller and reads the Host's floating banner the way a user
 * does, rather than reading the state behind it.
 *
 * What the page keeps in place is standing state, so the last case holds that
 * side of the split: nothing refused means no banner, and the Git line and the
 * read-only notice stay where they are.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsFormPathOp, SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  WorktreeSettingsController, type WorktreeSettings, type WorktreeSettingsState,
} from '../src/client/settings-store.ts'
import { WorktreeSettingsSection, type WorktreeSettingsSectionProps } from '../src/client/SettingsSection.tsx'
import { zh, type WorktreeCopyKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** One write waiting for the double's answer. */
interface HeldWrite {
  readonly ops: readonly SettingsFormPathOp[]
  finish(accepted?: boolean): void
}

/**
 * Mount the page over the real controller and a settings double.
 * @param writable - whether the double reports a writable deployment.
 * @returns the face that drives edits, and the writes awaiting an answer.
 */
async function mount(writable = true): Promise<{ face: ReturnType<WorktreeSettingsController['inject']>; writes: HeldWrite[] }> {
  let snapshot = {
    status: 'ready' as const, writable, revision: 1,
    value: { nestedRepositories: 'none', defaultPath: 'agents', nestedScanDepth: 1 },
    base: {}, user: {},
  }
  const listeners = new Set<() => void>()
  const writes: HeldWrite[] = []
  const scope: SettingsFormScope<WorktreeSettings> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: (ops, revision) => new Promise<boolean>((resolve) => {
      writes.push({ ops, revision, finish: (accepted = true) => {
        if (accepted) {
          const value = { ...snapshot.value }
          for (const op of ops) if (op.op === 'set') Object.assign(value, { [op.path[0]!]: op.value })
          snapshot = { ...snapshot, value, revision: snapshot.revision + 1 }
          for (const listener of listeners) listener()
        }
        resolve(accepted)
      } })
    }),
  }
  const face = new WorktreeSettingsController(scope).inject()
  const store = face.hooks.worktreeSettings
  // The renderer binds a declared store to a hook; the case binds the same store
  // the same way, so what renders is driven by the controller's own snapshots.
  const props = {
    useWorktreeSettings: (select: (state: WorktreeSettingsState) => WorktreeSettingsState) =>
      useSyncExternalStore(store.subscribe, () => select(store.getSnapshot())),
    edit: face.edit,
    t: (key: WorktreeCopyKey) => zh[key],
  } as unknown as WorktreeSettingsSectionProps
  // The Git line reads the Host route on mount. A spec has no route, and that
  // line is a status rather than the report under test, so the read stays open
  // instead of answering a failure the case would then have to wait out.
  vi.stubGlobal('fetch', () => new Promise(() => {}))
  await act(async () => { render(<WorktreeSettingsSection {...props} />) })
  return { face, writes }
}

describe('floating reports on the file backup page', () => {
  it('reports an invalid scan depth in the banner, and nowhere else on the page', async () => {
    const { face } = await mount()
    act(() => { face.edit('nestedScanDepth', 'half') })
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toBe(zh['settings.invalidNumber'])
    // The copy is the banner's alone: the page's own end must not carry it a
    // second time, where the scroll container would hide it.
    const shown = screen.getAllByText(zh['settings.invalidNumber'])
    expect(shown).toHaveLength(1)
    expect(shown[0]!.closest('[role="alert"]')).toBe(banner)
  })

  it('reports a write the Host refused in the banner', async () => {
    const { face, writes } = await mount()
    act(() => { face.edit('defaultPath', 'home') })
    await act(async () => { writes[0]!.finish(false) })
    expect(screen.getByRole('alert').textContent).toBe(zh['settings.saveFailed'])
  })

  it('reports a second refused write again, instead of leaving the first banner to expire', async () => {
    const { face, writes } = await mount()
    act(() => { face.edit('defaultPath', 'home') })
    await act(async () => { writes[0]!.finish(false) })
    const first = screen.getByRole('alert')
    // A refused field stays failed until a later write is accepted, so only the
    // reported sequence can tell this refusal apart from the one still standing.
    act(() => { face.edit('nestedRepositories', 'all') })
    await act(async () => { writes[1]!.finish(false) })
    const second = screen.getByRole('alert')
    expect(second.textContent).toBe(zh['settings.saveFailed'])
    // A new sequence remounts the banner, which restarts its hold and its fade.
    expect(second).not.toBe(first)
  })

  it('keeps a refused write on the page for as long as it stands', async () => {
    const { face, writes } = await mount()
    act(() => { face.edit('defaultPath', 'home') })
    await act(async () => { writes[0]!.finish(false) })
    // The banner reports the refusal once; this status line is the trace that
    // outlives it, because the control keeps showing a value the Host never took.
    expect(screen.getByRole('alert').textContent).toBe(zh['settings.saveFailed'])
    // The page has other status lines (the Git check among them), so the trace
    // is picked out by its own copy rather than by the role alone.
    const trace = screen.getAllByRole('status').find(node => node.textContent === zh['settings.saveFailed'])
    expect(trace).toBeDefined()
    // Correcting the field is what clears the trace, with the write that
    // succeeds rather than with the banner's own timer. The banner is not
    // asserted away: like the archive report, it stays for its own hold after
    // the answer it announced has already been superseded.
    act(() => { face.edit('defaultPath', 'sibling') })
    await act(async () => { writes[1]!.finish() })
    const left = screen.queryAllByText(zh['settings.saveFailed'])
    expect(left.length).toBeLessThanOrEqual(1)
    expect(left.filter(node => node.getAttribute('role') === 'status')).toHaveLength(0)
  })

  it('keeps standing state on the page and reports nothing while nothing was refused', async () => {
    const { face } = await mount()
    expect(screen.getByText(zh['settings.gitChecking']).textContent).toBe(zh['settings.gitChecking'])
    expect(screen.queryByRole('alert')).toBeNull()
    // A valid edit saves itself, and the page has nothing to celebrate: a
    // per-control "saved" banner would be noise on a page that always saves.
    act(() => { face.edit('nestedRepositories', 'all') })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the read-only notice on the page rather than in the banner', async () => {
    await mount(false)
    expect(screen.getByText(zh['settings.readOnly']).textContent).toBe(zh['settings.readOnly'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
