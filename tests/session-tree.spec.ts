/**
 * Session-tree resolution: whose copies a change-history page covers, and where
 * each of them restores into.
 *
 * These specs feed the resolver the two stores as plain services, because the
 * values under test are its own rules: the live store answers before the durable
 * one, a session neither store records resolves to nothing, and only delegated
 * children join the tree — never a fork, never a row whose directory is unknown.
 * Failure handling matters as much as the happy path: a catalog or header that
 * cannot be read degrades the page instead of failing it.
 */

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSessionCwd, resolveSessionTree } from '../src/session-tree.ts'

/** One catalog row the `subagents` double reports. */
type CatalogRow =
  | { readonly kind: 'child'; readonly id: string; readonly depth: number; readonly label?: string }
  | { readonly kind: 'diagnostic'; readonly id: string; readonly depth: number; readonly reason?: string }

/** The services one case provides, plus the calls the resolver made. */
interface Doubles {
  readonly ctx: Context
  readonly warnings: string[]
  /** Session ids the durable store was asked about, in order. */
  readonly stats: string[]
  /** Roots the catalog traversal was asked about, in order. */
  readonly traversals: string[]
}

/**
 * Build the context the resolver reads.
 * @param services - service name → implementation; omitted names read as absent.
 * @returns the context and the calls it recorded.
 */
function doubles(services: {
  live?: Readonly<Record<string, string>>
  stored?: Readonly<Record<string, string>>
  descendants?: Readonly<Record<string, readonly CatalogRow[]>>
  withoutCatalog?: boolean
  persistenceError?: Error
  catalogError?: Error
} = {}): Doubles {
  const warnings: string[] = []
  const stats: string[] = []
  const traversals: string[] = []
  const stores: Record<string, unknown> = {
    sessions: {
      get: (id: string) => services.live?.[id] === undefined
        ? undefined
        : { header: { cwd: services.live[id] } },
    },
    sessionPersistence: {
      stat: async (id: string) => {
        stats.push(id)
        if (services.persistenceError !== undefined) throw services.persistenceError
        const cwd = services.stored?.[id]
        return cwd === undefined ? undefined : { header: { cwd } }
      },
    },
  }
  if (services.withoutCatalog !== true) {
    stores.subagents = {
      listDescendants: async (root: string) => {
        traversals.push(root)
        if (services.catalogError !== undefined) throw services.catalogError
        return services.descendants?.[root] ?? []
      },
    }
  }
  const ctx = {
    get: (name: string) => stores[name],
    logger: { warn: (message: string) => { warnings.push(message) } },
  } as unknown as Context
  return { ctx, warnings, stats, traversals }
}

describe('resolving one session\'s working directory', () => {
  it('answers from the live store without consulting the durable one', async () => {
    const { ctx, stats } = doubles({ live: { 'session-1': 'C:/work' } })

    expect(await resolveSessionCwd(ctx, 'session-1')).toBe(resolve('C:/work'))
    expect(stats).toEqual([])
  })

  it('answers from the durable store for a session this process no longer holds', async () => {
    // A stopped teammate is the case: the page can be opened for it, but its
    // Agent is gone, so only the stored header names its directory.
    const { ctx } = doubles({ stored: { 'session-cold': 'C:/cold' } })

    expect(await resolveSessionCwd(ctx, 'session-cold')).toBe(resolve('C:/cold'))
  })

  it('normalizes the store\'s spelling of a directory', async () => {
    const { ctx } = doubles({ live: { 'session-1': 'C:/work/sub/..' } })

    expect(await resolveSessionCwd(ctx, 'session-1')).toBe(resolve('C:/work'))
  })

  it('refuses a stored directory that is not absolute instead of anchoring it to the process', async () => {
    const { ctx } = doubles({ stored: { 'session-1': 'relative/path' } })

    expect(await resolveSessionCwd(ctx, 'session-1')).toBeUndefined()
  })

  it('answers nothing for a session no store records', async () => {
    const { ctx } = doubles()

    expect(await resolveSessionCwd(ctx, 'session-elsewhere')).toBeUndefined()
  })

  it('logs an unreadable header and answers nothing for it, so one bad record does not fail the page', async () => {
    const { ctx, warnings } = doubles({ persistenceError: new Error('corrupt header') })

    expect(await resolveSessionCwd(ctx, 'session-corrupt')).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('session-corrupt')
    expect(warnings[0]).toContain('corrupt header')
  })
})

describe('resolving the session tree', () => {
  it('joins the delegated children with their labels and depths, and skips branches it cannot address', async () => {
    const { ctx } = doubles({
      live: { 'session-1': 'C:/work', 'child-1': 'C:/work', grandchild: 'C:/work' },
      stored: { 'child-2': 'C:/work/sub' },
      descendants: {
        'session-1': [
          { kind: 'child', id: 'child-1', depth: 1, label: 'Fix the widget' },
          { kind: 'diagnostic', id: 'child-unreadable', depth: 1, reason: 'corrupt' },
          { kind: 'child', id: 'child-2', depth: 1 },
          // No store knows this one's directory, so it can be neither listed
          // nor restored; its own branch is unreachable for the same reason.
          { kind: 'child', id: 'child-unknown', depth: 1 },
          { kind: 'child', id: 'grandchild', depth: 2, label: 'Nested work' },
        ],
      },
    })

    const tree = await resolveSessionTree(ctx, 'session-1')

    expect(tree.root).toEqual({ sessionId: 'session-1', cwd: resolve('C:/work'), depth: 0 })
    expect(tree.descendants).toEqual([
      { sessionId: 'child-1', cwd: resolve('C:/work'), depth: 1, label: 'Fix the widget' },
      // A child with no live Agent resolves through its stored header, which is
      // the case a stopped teammate is in.
      { sessionId: 'child-2', cwd: resolve('C:/work/sub'), depth: 1 },
      { sessionId: 'grandchild', cwd: resolve('C:/work'), depth: 2, label: 'Nested work' },
    ])
  })

  it('lists the session alone when the deployment mounts no subagent catalog', async () => {
    const { ctx } = doubles({ live: { 'session-1': 'C:/work' }, withoutCatalog: true })

    const tree = await resolveSessionTree(ctx, 'session-1')

    expect(tree.root).toEqual({ sessionId: 'session-1', cwd: resolve('C:/work'), depth: 0 })
    expect(tree.descendants).toEqual([])
  })

  it('degrades to the session alone when the catalog cannot be read', async () => {
    const { ctx, warnings } = doubles({
      live: { 'session-1': 'C:/work' },
      catalogError: new Error('sessionQuery is not mounted'),
    })

    const tree = await resolveSessionTree(ctx, 'session-1')

    expect(tree.root).toEqual({ sessionId: 'session-1', cwd: resolve('C:/work'), depth: 0 })
    expect(tree.descendants).toEqual([])
    expect(warnings[0]).toContain('sessionQuery is not mounted')
  })

  it('resolves no children when the page\'s own session has no directory', async () => {
    const { ctx, traversals } = doubles({ descendants: {} })

    const tree = await resolveSessionTree(ctx, 'session-elsewhere')

    expect(tree).toEqual({ root: undefined, descendants: [] })
    // There is no list to extend, so the catalog is not walked.
    expect(traversals).toEqual([])
  })

  it('does not consult the durable store when the live store answers', async () => {
    const { ctx, stats } = doubles({
      live: { 'session-1': 'C:/work', 'child-1': 'C:/work' },
      descendants: { 'session-1': [{ kind: 'child', id: 'child-1', depth: 1, label: 'Work' }] },
    })

    await resolveSessionTree(ctx, 'session-1')

    expect(stats).toEqual([])
  })
})
