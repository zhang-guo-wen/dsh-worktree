/**
 * The chip's start action end to end through the browser half's wiring.
 *
 * The Host creates the worktree's Session outside the Client's Session
 * Controller, so the action has to catalogue that Session before navigating:
 * navigation refuses an identity the Client cannot resolve, and that refusal is
 * what left the user on the original Session after a start that had succeeded.
 * These cases drive the registration's inject face with a fake Session
 * Controller and a stub route, and assert the pull-then-open order.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/client/index.ts'
import type { WorktreeChipInjected } from '../src/client/WorktreeChip.tsx'

afterEach(() => { vi.unstubAllGlobals() })

/** One Session row as the Client catalog holds it. */
interface Row {
  readonly cwd?: string
  readonly blank?: boolean
}

/** What one mounted browser half exposes to a case. */
interface Mounted {
  /** The registration's inject face: the chip's data and actions. */
  readonly face: WorktreeChipInjected
  /** Session rows the fake catalog holds; a refresh may add to them. */
  readonly rows: Record<string, Row>
  /** Recorded actions, in order. */
  readonly calls: string[]
  /** Session ids the fake navigation opened. */
  readonly opened: string[]
  /** Catalog subscribes and unsubscribes, in order. */
  readonly gates: string[]
  /** Catalog listeners still subscribed. */
  readonly listeners: Set<() => void>
}

/** A promise the fake navigation resolves when it is asked to open a Session. */
interface OpenAttempt {
  /** Resolves with the id navigation was asked for, before it is refused. */
  readonly attempted: Promise<string>
  /** The observer handed to {@link mount}. */
  readonly record: (sessionId: string) => void
}

/**
 * Track the first navigation attempt.
 * @returns the attempt promise and its observer.
 */
function openAttempt(): OpenAttempt {
  let record!: (sessionId: string) => void
  const attempted = new Promise<string>(resolve => { record = resolve })
  return { attempted, record }
}

/**
 * Mount the browser half over the Client services the chip's action reads.
 * @param options - what each list pull catalogues, and the navigation observer.
 * @returns the inject face and the recorded state.
 */
async function mount(options: {
  refresh?: (pull: number, rows: Record<string, Row>) => void
  onOpen?: (sessionId: string) => void
} = {}): Promise<Mounted> {
  const rows: Record<string, Row> = { sid: { cwd: '/repo', blank: true } }
  const calls: string[] = []
  const gates: string[] = []
  const opened: string[] = []
  const listeners = new Set<() => void>()
  let pulls = 0
  let face: WorktreeChipInjected | undefined

  const list = {
    getSnapshot: () => ({ ids: Object.keys(rows), byId: rows }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      gates.push('subscribe')
      return () => { listeners.delete(listener); gates.push('unsubscribe') }
    },
  }
  const scope = {
    get: (name: string) => (name === 'sessions' ? {
      list,
      refresh: async () => {
        pulls += 1
        calls.push('refresh')
        options.refresh?.(pulls, rows)
      },
    } : undefined),
    effect: (fn: () => unknown) => { fn() },
    uiWorkspace: {
      openSession: (sessionId: string) => {
        calls.push('open')
        options.onOpen?.(sessionId)
        // The rule the real navigation enforces: an identity the catalog does
        // not hold cannot be retained.
        if (rows[sessionId] === undefined) throw new Error(`sessions.retain: unknown session ${sessionId}`)
        opened.push(sessionId)
      },
    },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback(); return () => {} },
      register: (entry: { inject: () => WorktreeChipInjected }) => { face = entry.inject(); return () => {} },
    },
  }

  const ctx = new Context()
  // The plugin's own `inject` must resolve before it applies; the inner
  // `ctx.inject` override below supplies the scope the chip registers into.
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
  ctx.provide('slots', {} as never)
  ctx.provide('conversation', {} as never)
  ctx.provide('uiWorkspace', {} as never)
  ctx.inject = ((_deps: unknown, cb: (scope: unknown) => unknown) => {
    cb(scope)
    return undefined
  }) as typeof ctx.inject
  await ctx.plugin(plugin, {}).await()

  if (face === undefined) throw new Error('the browser half registered no chip')
  return { face, rows, calls, opened, gates, listeners }
}

/**
 * Stub the Host route for one case.
 * @param start - the body `start` answers with.
 */
function stubRoute(start: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = String(url).split('/').pop()
    const body = method === 'start'
      ? start
      : { worktrees: [{ path: '/repo', branch: 'main', head: 'a'.repeat(40), main: true }] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

/**
 * Probe the Session and stage the choice.
 * @param mounted - the mounted half.
 */
async function stage(mounted: Mounted): Promise<void> {
  await mounted.face.load('sid')
  mounted.face.setEnabled(true)
}

describe('worktree chip navigation', () => {
  it('catalogues the started Session before opening it', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const attempt = openAttempt()
    const mounted = await mount({
      refresh: (pull, rows) => { if (pull === 1) rows['s-1'] = { cwd: '/repo-wt', blank: true } },
      onOpen: attempt.record,
    })

    await stage(mounted)
    expect(await attempt.attempted).toBe('s-1')
    expect(mounted.calls).toEqual(['refresh', 'open'])
    expect(mounted.face.hooks.worktreeSeat.getSnapshot().error).toBeNull()
  })

  it('pulls again when the first pull joined a read older than the Session', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const attempt = openAttempt()
    const mounted = await mount({
      // A list read that started before the Host created the Session cannot
      // contain it; only the second pull catalogues the row.
      refresh: (pull, rows) => { if (pull === 2) rows['s-1'] = { cwd: '/repo-wt', blank: true } },
      onOpen: attempt.record,
    })

    await stage(mounted)
    expect(await attempt.attempted).toBe('s-1')
    expect(mounted.calls).toEqual(['refresh', 'refresh', 'open'])
  })

  it('reports a navigation refusal on the seat instead of failing silently', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const attempt = openAttempt()
    const mounted = await mount({ onOpen: attempt.record })

    await stage(mounted)
    expect(await attempt.attempted).toBe('s-1')
    // The refusal is raised after navigation was asked, so let the seat's own
    // error handling run before reading the failure back.
    await new Promise(resolve => { setImmediate(resolve) })
    expect(mounted.opened).toEqual([])
    expect(mounted.calls).toEqual(['refresh', 'refresh', 'open'])
    expect(mounted.face.hooks.worktreeSeat.getSnapshot().error).toBe('sessions.retain: unknown session s-1')
  })

  it('keeps one catalog subscription for the Session on screen', async () => {
    stubRoute({ sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' })
    const mounted = await mount()
    mounted.rows['sid-2'] = { cwd: '/repo-2', blank: true }

    await mounted.face.load('sid')
    expect(mounted.listeners.size).toBe(1)
    // Switching Sessions replaces the gate: a listener left behind would
    // re-publish the previous Session's directory on every catalog change.
    await mounted.face.load('sid-2')
    expect(mounted.listeners.size).toBe(1)
    expect(mounted.gates).toEqual(['subscribe', 'unsubscribe', 'subscribe'])
  })
})
