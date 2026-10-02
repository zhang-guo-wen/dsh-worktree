/**
 * Browser half of the second notice: which removals get a banner.
 *
 * The observer is pure bookkeeping over the Workspace list the sidebar already
 * renders, so these cases drive it directly: a row disappearing produces at
 * most one probe, and only this plugin's own archive outcomes produce a banner.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  observeCheckouts, type CheckoutNotice, type CheckoutProbeResult, type NoticeQueue, type NoticedWorkspace,
} from '../src/client/checkout-notice-store.ts'

/** One Workspace row for the fixture. */
function row(workspaceId: string, path: string, sessionIds: string[]): NoticedWorkspace {
  return { workspaceId, path, sessionIds: sessionIds as NoticedWorkspace['sessionIds'] }
}

/** A Workspace source whose snapshot the case replaces by hand. */
function source(items: NoticedWorkspace[], archivedSessionIds: string[] = []) {
  let snapshot = { items, archivedSessionIds: archivedSessionIds as never }
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    /** Replace the snapshot and notify, as an arriving frame would. */
    publish(next: NoticedWorkspace[], archived = archivedSessionIds): void {
      snapshot = { items: next, archivedSessionIds: archived as never }
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A queue the observer can replace without a store engine. */
function queue(): NoticeQueue & { readonly entries: readonly CheckoutNotice[] } {
  let entries: CheckoutNotice[] = []
  return {
    get entries() { return entries },
    getSnapshot: () => entries,
    set: (next) => { entries = [...next] },
  }
}

describe('checkout notices', () => {
  it('reports nothing from the baseline snapshot', () => {
    const notices = queue()
    const probe = vi.fn()
    const workspaces = source([row('w1', 'C:/repo-wt', ['s1'])], ['s1'])
    observeCheckouts(workspaces, probe, notices)
    // Seeding the baseline is not a removal: the Client mounts long after any
    // archive a previous page load caused.
    expect(probe).not.toHaveBeenCalled()
    expect(notices.entries).toEqual([])
  })

  it('reports a removal', async () => {
    const notices = queue()
    const probe = vi.fn(async () => ({ outcome: 'removed' as const }))
    const workspaces = source([row('w1', 'C:/repo-wt', ['s1'])])
    observeCheckouts(workspaces, probe, notices)
    workspaces.publish([], ['s1'])
    await vi.waitFor(() => expect(notices.entries).toHaveLength(1))
    expect(probe).toHaveBeenCalledWith('C:/repo-wt')
    expect(notices.entries[0]).toMatchObject({ path: 'C:/repo-wt', outcome: 'removed' })
  })

  it('reports a kept checkout with the Host’s reason', async () => {
    const notices = queue()
    const probe = vi.fn(async () => ({ outcome: 'kept' as const, reason: 'it has uncommitted work' }))
    const workspaces = source([row('w1', 'C:/repo-wt', ['s1'])])
    observeCheckouts(workspaces, probe, notices)
    workspaces.publish([], ['s1'])
    await vi.waitFor(() => expect(notices.entries).toHaveLength(1))
    expect(notices.entries[0]).toMatchObject({ outcome: 'kept', reason: 'it has uncommitted work' })
  })

  it('stays silent for a row the user deleted by hand', async () => {
    const notices = queue()
    // The Host never touched this path, so its probe answers `unknown` — the
    // directory is still there and no deletion may be claimed.
    const probe = vi.fn(async (): Promise<CheckoutProbeResult> => ({ outcome: 'unknown' }))
    const workspaces = source([row('w1', 'C:/plain', ['s1'])], ['other'])
    observeCheckouts(workspaces, probe, notices)
    workspaces.publish([row('w2', 'C:/other', ['s2'])], ['other'])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices.entries).toEqual([])
  })

  it('does not probe a row whose sessions were never archived', () => {
    const notices = queue()
    const probe = vi.fn()
    const workspaces = source([row('w1', 'C:/repo-wt', ['s1'])])
    observeCheckouts(workspaces, probe, notices)
    // Same disappearance, but no archive: this is the Workspace list dropping a
    // registration, which never deletes files.
    workspaces.publish([])
    expect(probe).not.toHaveBeenCalled()
  })

  it('suppresses a probe answer that arrives after disposal', async () => {
    const notices = queue()
    let resolveProbe: (value: CheckoutProbeResult) => void = () => {}
    const probe = vi.fn(() => new Promise<CheckoutProbeResult>((resolve) => { resolveProbe = resolve }))
    const workspaces = source([row('w1', 'C:/repo-wt', ['s1'])])
    const dispose = observeCheckouts(workspaces, probe, notices)
    workspaces.publish([], ['s1'])
    dispose()
    resolveProbe({ outcome: 'removed' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices.entries).toEqual([])
  })
})
