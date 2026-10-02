/**
 * Post-archive checkout removal.
 *
 * The trigger is the Workspace registry's `workspace/session-stop`
 * notification, which the registry dispatches after an archive set is durable.
 * These specs drive that event against a stubbed worktree service so the
 * removal contract is asserted without a repository: which checkouts go, which
 * are kept, and what happens when the removal itself is refused.
 */

import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearArchiveOutcomes, installArchiveCleanup, probeArchiveOutcome,
} from '../src/archive-cleanup.ts'
import type { WorktreeService } from '../src/service.ts'

/** The outcome store is module-level, so each case starts from an empty one. */
beforeEach(() => { clearArchiveOutcomes() })

/** One session as the cleanup reads it: the live store only needs a cwd. */
type LiveSession = { header: { cwd?: string } }

/** A workspace registry double with just the members the cleanup reads. */
function registry(workspaces: Array<{ id: string; path: string; sessionIds: string[] }>, archived: string[]) {
  const deleted: string[] = []
  return {
    deleted,
    archivedSessionIds: archived,
    list: () => workspaces,
    delete: async (id: string) => { deleted.push(id); return true },
  }
}

/**
 * Mount the cleanup on a context carrying the services it injects.
 * @param options - workspace registry, live sessions, and the service stub.
 * @returns the context, the removal log, and the injected registry.
 */
async function mount(options: {
  workspaces: Array<{ id: string; path: string; sessionIds: string[] }>
  archived: string[]
  sessions?: Record<string, LiveSession>
  inspect?: WorktreeService['inspectLinkedCheckout']
  remove?: WorktreeService['remove']
}) {
  const state = registry(options.workspaces, options.archived)
  const removed: Array<{ cwd: string; path: string }> = []
  const service = {
    inspectLinkedCheckout: options.inspect ?? (async () => ({ repositoryRoot: 'C:/repo', path: 'C:/repo-wt', main: 'C:/repo' })),
    remove: options.remove ?? (async (request: { cwd: string; path: string }) => {
      removed.push(request)
      return { path: request.path, branch: 'work', head: 'abc', main: false }
    }),
  } as unknown as WorktreeService
  const ctx = new Context()
  await ctx.plugin({
    name: 'providers',
    apply(sibling: Context) {
      sibling.provide('workspaceRegistry', state)
      sibling.provide('sessions', {
        get: (id: string) => options.sessions?.[id],
      })
    },
  }).await()
  installArchiveCleanup(ctx, service)
  return { ctx, state, removed }
}

describe('post-archive checkout removal', () => {
  it('removes the checkout and the workspace record of the archived session', async () => {
    const { ctx, state, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
    })
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await vi.waitFor(() => expect(removed).toHaveLength(1))
    expect(removed[0]).toEqual({ cwd: 'C:/repo', path: 'C:/repo-wt' })
    await vi.waitFor(() => expect(state.deleted).toEqual(['w1']))
  })

  it('ignores a session that is not archived', async () => {
    const { ctx, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
      archived: [],
      sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
    })
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(removed).toEqual([])
  })

  it('keeps a checkout that is not a linked worktree', async () => {
    const { ctx, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo', sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: 'C:/repo' } } },
      inspect: async () => undefined,
    })
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(removed).toEqual([])
  })

  it('keeps a checkout whose removal the service refuses, without failing the archive', async () => {
    const warn = vi.fn()
    const { ctx, state, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
      remove: async () => { throw new Error('refusing to remove "C:/repo-wt": it has uncommitted work (2 path(s))') },
    })
    ctx.logger.warn = warn
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(removed).toEqual([])
    expect(state.deleted).toEqual([])
  })

  it('does not remove a parent checkout when a subagent is archived first', async () => {
    // A subagent shares its parent's cwd, so its archive must not end a
    // workspace its parent is still working in.
    const { ctx, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['parent', 'child'] }],
      archived: ['child'],
      sessions: { child: { header: { cwd: 'C:/repo-wt' } } },
    })
    ctx.emit('workspace/session-stop', { sessionId: 'child' })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(removed).toEqual([])
  })

  it('removes the checkout when the last archived session is the workspace owner', async () => {
    const { ctx, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['parent', 'child'] }],
      archived: ['child', 'parent'],
      sessions: { parent: { header: { cwd: 'C:/repo-wt' } } },
    })
    ctx.emit('workspace/session-stop', { sessionId: 'parent' })
    await vi.waitFor(() => expect(removed).toHaveLength(1))
  })

  it('survives a service that cannot even inspect the path', async () => {
    const warn = vi.fn()
    const { ctx, state, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/gone', sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: 'C:/gone' } } },
      inspect: async () => { throw new Error('not a git repository') },
    })
    ctx.logger.warn = warn
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(removed).toEqual([])
    expect(state.deleted).toEqual([])
  })
})

/**
 * The outcome record the browser half reads.
 *
 * A Workspace row is gone whether its checkout was deleted or kept, so the
 * Client cannot answer this itself; these cases pin the answer the Host leaves
 * behind, which is what the second notice renders.
 */
describe('archive outcome record', () => {
  it('records a removal the Host performed', async () => {
    const { ctx, removed } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
    })
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await vi.waitFor(() => expect(removed).toHaveLength(1))
    expect(probeArchiveOutcome('C:/repo-wt')).toEqual({ outcome: 'removed' })
  })

  it('records the refusal when the checkout was kept', async () => {
    const { ctx } = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
      remove: async () => { throw new Error('it has uncommitted work (2 path(s))') },
    })
    ctx.logger.warn = vi.fn()
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await vi.waitFor(() => expect(probeArchiveOutcome('C:/repo-wt').outcome).toBe('kept'))
    expect(probeArchiveOutcome('C:/repo-wt')).toMatchObject({
      outcome: 'kept',
      reason: expect.stringContaining('uncommitted work'),
    })
  })

  it('says nothing about a path no archive touched', async () => {
    // A row the user deleted by hand leaves this path unrecorded, which is what
    // keeps that case silent on the browser side.
    expect(probeArchiveOutcome('C:/never-archived')).toEqual({ outcome: 'unknown' })
  })

  it('replaces an earlier refusal at the same path', async () => {
    const first = await mount({
      workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
      remove: async () => { throw new Error('uncommitted work') },
    })
    first.ctx.logger.warn = vi.fn()
    first.ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await vi.waitFor(() => expect(probeArchiveOutcome('C:/repo-wt').outcome).toBe('kept'))

    const second = await mount({
      workspaces: [{ id: 'w2', path: 'C:/repo-wt', sessionIds: ['s2'] }],
      archived: ['s2'],
      sessions: { s2: { header: { cwd: 'C:/repo-wt' } } },
    })
    second.ctx.emit('workspace/session-stop', { sessionId: 's2' })
    await vi.waitFor(() => expect(probeArchiveOutcome('C:/repo-wt')).toEqual({ outcome: 'removed' }))
  })
})
