/**
 * The worktree seat's staged choice.
 *
 * The seat is the browser half's whole decision surface: the boolean that
 * starts the checkout, and the local branch the new branch starts from. Both are
 * probed and staged against a Session's directory and spent by one start. These
 * cases pin what the control reads — visibility, the staged base, the branch
 * list behind the menu, and that a start consumes the choice.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkoutAt, WorktreeSeatController } from '../src/client/seat-store.ts'

afterEach(() => { vi.unstubAllGlobals() })

/**
 * Stub the route responses for one case.
 * @param handler - decides the response per call.
 */
function stubRoute(handler: (method: string) => { ok: boolean; body: unknown; status?: number }): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = String(url).split('/').pop() ?? ''
    const { ok, body, status } = handler(method)
    return new Response(JSON.stringify(body), {
      status: status ?? (ok ? 200 : 500),
      headers: { 'content-type': 'application/json' },
    })
  }))
}

/** One checkout as the route lists it. */
function checkout(path: string, branch: string, main = false) {
  return { path, branch, head: 'a'.repeat(40), main }
}

/** The body of the last route call, for assertions about what was sent. */
function lastBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls
  const [, init] = calls[calls.length - 1] as [string, { body: string }]
  return JSON.parse(init.body) as Record<string, unknown>
}

describe('worktree seat', () => {
  it('starts hidden and unstaged', () => {
    const seat = new WorktreeSeatController()
    expect(seat.store.getSnapshot()).toEqual({
      visible: false,
      enabled: false,
      creating: false,
      base: 'HEAD',
      branches: null,
      started: null,
      checkoutBranch: '',
      isolated: false,
      error: null,
    })
  })

  it('becomes visible when the Session directory is a Git repository', async () => {
    stubRoute(() => ({ ok: true, body: { worktrees: [checkout('/repo', 'main', true)] } }))
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    expect(seat.store.getSnapshot()).toMatchObject({ visible: true, base: 'main' })
    expect(seat.cwd()).toBe('/repo')
  })

  it('reports a linked checkout the Session already runs in instead of offering it', async () => {
    stubRoute(() => ({
      ok: true,
      body: { worktrees: [checkout('/repo', 'main', true), checkout('/repo/.agents/wt-x', 'dsh/wt-x')] },
    }))
    const seat = new WorktreeSeatController()

    // The Session arrived in that checkout by an earlier start; offering the
    // control again would nest a checkout inside a checkout one click later.
    await seat.load('/repo/.agents/wt-x')
    expect(seat.store.getSnapshot()).toMatchObject({
      visible: true, isolated: true, checkoutBranch: 'dsh/wt-x', base: 'dsh/wt-x',
    })

    // The original Session in the main checkout still gets to choose.
    await seat.load('/repo')
    expect(seat.store.getSnapshot()).toMatchObject({
      visible: true, isolated: false, checkoutBranch: 'main', base: 'main',
    })
  })

  it('keeps reporting the base it created that checkout from', async () => {
    stubRoute(method => method === 'start'
      ? {
        ok: true,
        body: { sessionId: 's-1', worktree: { path: '/repo/.agents/dsh-wt-1' }, workspaceId: 'w-1' },
      }
      : {
        ok: true,
        body: { worktrees: [checkout('/repo', 'dev', true), checkout('/repo/.agents/dsh-wt-1', 'dsh/wt-1')] },
      })
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    expect(seat.store.getSnapshot().base).toBe('dev')
    await seat.start(() => {})

    // The locked control reports the choice (dev) rather than the branch that
    // choice produced (dsh/wt-1), so arriving there does not lose the origin.
    await seat.load('/repo/.agents/dsh-wt-1')
    expect(seat.store.getSnapshot()).toMatchObject({
      isolated: true, base: 'dev', checkoutBranch: 'dsh/wt-1',
    })
  })

  it('reports another page’s checkout with the branch it holds', async () => {
    stubRoute(() => ({
      ok: true,
      body: { worktrees: [checkout('/repo', 'dev', true), checkout('/repo/.agents/other', 'feature/x')] },
    }))
    const seat = new WorktreeSeatController()
    // Nothing in this page created that checkout, so only its branch is known.
    await seat.load('/repo/.agents/other')
    expect(seat.store.getSnapshot()).toMatchObject({ isolated: true, base: 'feature/x' })
  })

  it('stays hidden without a directory or without a repository', async () => {
    const seat = new WorktreeSeatController()
    await seat.load(undefined)
    expect(seat.store.getSnapshot()).toMatchObject({ visible: false, base: 'HEAD' })
    expect(seat.cwd()).toBeUndefined()

    stubRoute(() => ({ ok: false, body: { error: { message: 'not a git repository' } } }))
    await seat.load('/plain')
    expect(seat.store.getSnapshot().visible).toBe(false)
  })

  it('names the checkout that contains the directory', () => {
    const worktrees = [checkout('/repo', 'main', true), checkout('/repo-wt-x', 'dsh/wt-x')]
    // A directory below the main checkout belongs to the main checkout, not to
    // the sibling worktree whose path merely shares the repository's prefix.
    expect(checkoutAt('/repo/src/app', worktrees)).toMatchObject({ path: '/repo', branch: 'main' })
    expect(checkoutAt('/repo-wt-x/src', worktrees)).toMatchObject({ branch: 'dsh/wt-x' })
    expect(checkoutAt('C:\\repo\\sub', [checkout('C:/repo', 'main', true)])).toMatchObject({ branch: 'main' })
    expect(checkoutAt('/elsewhere', worktrees)).toBeUndefined()
  })

  it('offers the local branches the menu reads, and stages the picked one', async () => {
    stubRoute(method => method === 'branches'
      ? { ok: true, body: { branches: ['dev', 'release-1.2'] } }
      : { ok: true, body: { worktrees: [checkout('/repo', 'dev', true)] } })
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    expect(seat.store.getSnapshot().branches).toBeNull()

    await seat.loadBranches()
    expect(seat.store.getSnapshot().branches).toEqual(['dev', 'release-1.2'])

    seat.selectBase('release-1.2')
    expect(seat.store.getSnapshot().base).toBe('release-1.2')
  })

  it('keeps the staged base when the branch read fails', async () => {
    stubRoute(() => ({ ok: false, body: { error: { message: 'not a git repository' } } }))
    const seat = new WorktreeSeatController()
    await seat.load('/plain')
    await seat.loadBranches()
    expect(seat.store.getSnapshot()).toMatchObject({ base: 'HEAD', branches: [] })
  })

  it('stages and clears the choice without starting', () => {
    const seat = new WorktreeSeatController()
    seat.setEnabled(true)
    expect(seat.store.getSnapshot().enabled).toBe(true)
    seat.setEnabled(false)
    expect(seat.store.getSnapshot().enabled).toBe(false)
  })

  it('starts the session from the staged base and consumes the choice', async () => {
    stubRoute(method => method === 'start'
      ? { ok: true, body: { sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' } }
      : { ok: true, body: { worktrees: [checkout('/repo', 'dev', true)] } })
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    seat.selectBase('release-1.2')
    seat.setEnabled(true)

    const opened: string[] = []
    const started = await seat.start(id => opened.push(id))
    expect(started).toBe('s-1')
    expect(opened).toEqual(['s-1'])
    expect(lastBody()).toEqual({ cwd: '/repo', base: 'release-1.2' })
    // The choice described the session just created, so it is spent.
    expect(seat.store.getSnapshot()).toMatchObject({ enabled: false, creating: false, error: null })
  })

  it('reports a refused start and clears the choice so it cannot silently re-fire', async () => {
    stubRoute(method => method === 'start'
      ? { ok: false, body: { error: { message: 'branch already exists' } } }
      : { ok: true, body: { worktrees: [] } })
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    seat.setEnabled(true)

    const opened: string[] = []
    expect(await seat.start(id => opened.push(id))).toBeUndefined()
    expect(opened).toEqual([])
    expect(seat.store.getSnapshot()).toMatchObject({ enabled: false, creating: false, error: 'branch already exists' })
  })

  it('reports a failed open instead of throwing, since the checkout exists', async () => {
    stubRoute(method => method === 'start'
      ? { ok: true, body: { sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' } }
      : { ok: true, body: { worktrees: [] } })
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    seat.setEnabled(true)

    expect(await seat.start(() => { throw new Error('sessions.retain: unknown session s-1') })).toBe('s-1')
    expect(seat.store.getSnapshot().error).toBe('sessions.retain: unknown session s-1')
  })

  it('reopens the Session it created instead of creating a second checkout', async () => {
    stubRoute(method => method === 'start'
      ? { ok: true, body: { sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' } }
      : { ok: true, body: { worktrees: [] } })
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    seat.setEnabled(true)
    const starts = (): number => (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length

    await seat.start(() => { throw new Error('sessions.retain: unknown session s-1') })
    const afterFirst = starts()
    expect(seat.store.getSnapshot().started).toBe('s-1')

    // The route already created the checkout; a second attempt must show that
    // Session rather than leave a second checkout behind.
    const opened: string[] = []
    expect(await seat.start(id => opened.push(id))).toBe('s-1')
    expect(opened).toEqual(['s-1'])
    expect(starts()).toBe(afterFirst)
    expect(seat.store.getSnapshot().error).toBeNull()
  })

  it('forgets a start when the screen moves to another Session', async () => {
    stubRoute(method => method === 'start'
      ? { ok: true, body: { sessionId: 's-1', worktree: { path: '/repo-wt' }, workspaceId: 'w-1' } }
      : { ok: true, body: { worktrees: [] } })
    const seat = new WorktreeSeatController()
    await seat.load('/repo')
    seat.setEnabled(true)
    await seat.start(() => { throw new Error('sessions.retain: unknown session s-1') })

    seat.resetStart()
    expect(seat.store.getSnapshot().started).toBeNull()
  })

  it('refuses to start without a probed directory', async () => {
    const seat = new WorktreeSeatController()
    expect(await seat.start(() => {})).toBeUndefined()
    expect(seat.store.getSnapshot().error).toMatch(/working directory/)
  })
})
