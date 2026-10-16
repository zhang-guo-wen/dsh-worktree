/**
 * Post-archive checkout removal.
 *
 * There are two triggers, because the registry reports only one of them. The
 * `workspace/session-stop` notification arrives when an archive stops running
 * work; an archive of an idle session — the sidebar's own action — writes the
 * durable set and notifies nobody, so the durable set is re-read on an interval
 * and every session that appeared in it since the previous sweep is cleaned up.
 *
 * These specs drive both against a stubbed worktree service so the removal
 * contract is asserted without a repository: which checkouts go, which are kept,
 * and what happens when the removal itself is refused.
 */

import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearArchiveOutcomes, installArchiveCleanup, probeArchiveOutcome,
} from '../src/archive-cleanup.ts'
import { FileGuard } from '../src/file-guard.ts'
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
  guard?: FileGuard
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
  installArchiveCleanup(ctx, service, options.guard, { removeCheckouts: true })
  return { ctx, state, removed }
}

/**
 * One durable write of the workspace registry's global singleton, as the
 * storage layer announces it.
 *
 * The archive set travels inside the snapshot, but the listener reads the
 * registry rather than this value, so the shape here only has to be the real
 * one — whatever the storage layer passed through.
 * @param archived - the archived session ids after the write.
 * @returns the event payload the cleanup listens for.
 */
function archiveWrite(archived: readonly string[]) {
  return {
    domain: 'workspace',
    table: '',
    key: '',
    operation: 'put' as const,
    value: { initialized: true, workspaceIds: [], archivedSessionIds: [...archived] },
  }
}

/**
 * The session directories one guard root holds.
 * @param root - the guard root.
 * @returns the directory names, which are the session keys.
 */
async function backupDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
}

/**
 * Protect one file for one session so a backup directory exists.
 * @param root - the guard root.
 * @param session - the session id owning the copy.
 * @returns the guard that took the copy.
 */
async function protectedFile(root: string, session: string): Promise<FileGuard> {
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const file = join(workspace, 'notes.txt')
  await writeFile(file, 'before')
  const guard = new FileGuard({ directory: join(root, 'guard'), denyDestructiveCommands: true })
  await guard.protect({ session: { id: session, header: { cwd: workspace } } }, file)
  return guard
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

  it('deletes the archived session file backups, alongside the checkout removal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-archive-guard-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const file = join(workspace, 'notes.txt')
    await writeFile(file, 'before')
    const guard = new FileGuard({ directory: join(root, 'guard'), denyDestructiveCommands: true })
    await guard.protect({ session: { id: 's1', header: { cwd: workspace } } }, file)
    expect((await readdir(join(root, 'guard'), { withFileTypes: true })).filter(entry => entry.isDirectory())).toHaveLength(1)

    // The same notification that removes a checkout also ends the session's
    // backups, so the guard is wired the same way — and a sweep would end them
    // anyway, because the archive set already names this session.
    const { ctx, state } = await mount({
      workspaces: [{ id: 'w1', path: workspace, sessionIds: ['s1'] }],
      archived: ['s1'],
      sessions: { s1: { header: { cwd: workspace } } },
      guard,
    })
    ctx.emit('workspace/session-stop', { sessionId: 's1' })
    await vi.waitFor(() => expect(state.deleted).toEqual(['w1']))
    await vi.waitFor(() => expect(existsSync(join(root, 'guard'))).toBe(true))
    expect((await readdir(join(root, 'guard'), { withFileTypes: true })).filter(entry => entry.isDirectory())).toHaveLength(0)

    await rm(root, { recursive: true, force: true })
  })
})

/**
 * The archives no notification reports.
 *
 * `workspace/session-stop` reaches this module only when an archive stops
 * running work. A plain archive — the sidebar's own action — dispatches nothing,
 * but it does write the registry's global singleton, and the storage layer
 * announces that write, so the cleanup runs on `domain/changed`. The arrival
 * test is deliberately not retroactive: the set a host starts with is recorded
 * as already handled.
 */
describe('archives the workspace registry does not announce', () => {
  it('cleans up a session the moment its archive is durable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-archive-event-'))
    try {
      const guard = await protectedFile(root, 's1')
      const { ctx, state, removed } = await mount({
        workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
        archived: [],
        sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
        guard,
      })

      // The sidebar's own archive: no stop notification, one durable write.
      state.archivedSessionIds.push('s1')
      ctx.emit('domain/changed', archiveWrite(state.archivedSessionIds))

      await vi.waitFor(async () => expect(await backupDirectories(join(root, 'guard'))).toEqual([]))
      await vi.waitFor(() => expect(removed).toHaveLength(1))
      await vi.waitFor(() => expect(state.deleted).toEqual(['w1']))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves a session archived before this host started alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-archive-event-'))
    try {
      const guard = await protectedFile(root, 's1')
      // The archive happened while no host was watching. Announcing it again —
      // which any later registry write does — must not delete its backups: that
      // would carry out an archive this process never saw.
      const { ctx, state, removed } = await mount({
        workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
        archived: ['s1'],
        sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
        guard,
      })

      ctx.emit('domain/changed', archiveWrite(state.archivedSessionIds))
      await new Promise(resolve => { setTimeout(resolve, 20) })

      expect(await backupDirectories(join(root, 'guard'))).toHaveLength(1)
      expect(removed).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ignores a write that is not the archive set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-archive-event-'))
    try {
      const guard = await protectedFile(root, 's1')
      const { ctx, state, removed } = await mount({
        workspaces: [{ id: 'w1', path: 'C:/repo-wt', sessionIds: ['s1'] }],
        archived: [],
        sessions: { s1: { header: { cwd: 'C:/repo-wt' } } },
        guard,
      })

      state.archivedSessionIds.push('s1')
      // Another domain, and a workspace record write: neither is the archive.
      ctx.emit('domain/changed', { ...archiveWrite(['s1']), domain: 'settings' })
      ctx.emit('domain/changed', { ...archiveWrite(['s1']), table: 'workspaces', key: 'w1' })
      await new Promise(resolve => { setTimeout(resolve, 20) })

      expect(await backupDirectories(join(root, 'guard'))).toHaveLength(1)
      expect(removed).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
