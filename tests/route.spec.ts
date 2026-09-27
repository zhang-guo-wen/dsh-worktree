/**
 * The `/worktree/api` route contract.
 *
 * These specs drive the route handler through a real HTTP server against a
 * scratch repository, because the route's value is its ordering and rollback:
 * the checkout, the workspace record, and the session must appear together.
 * The workspace registry and agent registry are doubles — they are other
 * packages' contracts — while Git is real, since the failure modes under test
 * are Git's own.
 */

import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { registerRoute } from '../src/route.ts'
import { WorktreeService } from '../src/service.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-worktree-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-worktree-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

/** Scratch directories created by the current case, removed on teardown. */
const created: string[] = []
/** Live servers created by the current case, closed on teardown. */
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => { resolve() })
  })))
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

/**
 * Run git in a fixture.
 * @param cwd - directory to run in.
 * @param args - git arguments.
 * @returns the command's stdout.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } })
}

/**
 * Create a repository with one commit.
 * @returns the repository root and its scratch parent.
 */
function repository(): { root: string; scratch: string } {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-worktree-route-')))
  created.push(scratch)
  const root = join(scratch, 'repo')
  git(scratch, ['init', '-q', '-b', 'main', root])
  writeFileSync(join(root, 'tracked.txt'), 'base\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])
  return { root, scratch }
}

/** Doubles for the two registries the route consumes, recording their calls. */
interface Harness {
  readonly url: string
  readonly createdWorkspaces: string[]
  readonly createdSessions: { cwd: string | undefined }[]
  /** Session ids the Workspace ledger was asked to account, in order. */
  readonly attachedSessions: string[]
  failWorkspace: { value: boolean }
  failSession: { value: boolean }
  failAttach: { value: boolean }
}

/**
 * Provide services from a sibling plugin fiber, as the loader does.
 *
 * A service provided on the mounting context itself resolves without `inject`,
 * so providing them there would hide a route that never declared which
 * services its handler reads — the failure this harness exists to catch.
 * @param ctx - the context the sibling is loaded in.
 * @param services - service name → implementation.
 */
async function provideSibling(ctx: Context, services: Record<string, unknown>): Promise<void> {
  await ctx.plugin({
    name: 'providers',
    apply(sibling: Context) {
      for (const [name, value] of Object.entries(services)) sibling.provide(name, value)
    },
  }).await()
}

/**
 * Mount the route on a live server over a real worktree service.
 *
 * The webserver is provided AFTER `registerRoute` runs, which mirrors the
 * activation order that matters: plugin activation is unordered, so a route
 * that reads the service once with `ctx.get` would be dropped silently. The
 * route must wait for the service instead.
 * @returns the server URL and the recorded registry calls.
 */
async function mount(): Promise<Harness> {
  const createdWorkspaces: string[] = []
  const createdSessions: { cwd: string | undefined }[] = []
  const attachedSessions: string[] = []
  const failWorkspace = { value: false }
  const failSession = { value: false }
  const failAttach = { value: false }
  const ctx = new Context()
  await provideSibling(ctx, {
    workspaceRegistry: {
      create: async (path: string) => {
        createdWorkspaces.push(path)
        if (failWorkspace.value) throw new Error('workspace registry refused')
        return {
          id: `workspace-${createdWorkspaces.length}`,
          path,
          attachSession: async (sessionId: string) => {
            attachedSessions.push(sessionId)
            if (failAttach.value) throw new Error('the session cwd does not resolve')
          },
        }
      },
    },
    agents: {
      create: async (options: { meta?: { cwd?: string } }) => {
        createdSessions.push({ cwd: options.meta?.cwd })
        if (failSession.value) throw new Error('agent registry refused')
        return { agent: { id: `session-${createdSessions.length}` } }
      },
    },
  })

  // The route waits for `webServer`; providing it afterwards is what proves
  // the wait works.
  registerRoute(ctx, new WorktreeService())
  await provideSibling(ctx, {
    webServer: {
      register(route: { path: string; handler: (req: never, res: never) => void }) {
        const server = createServer((req, res) => { void route.handler(req as never, res as never) })
        servers.push(server)
        server.listen(0, '127.0.0.1')
        return () => { server.close() }
      },
    },
  })

  // The deferred injection resolves on a microtask; give it one.
  await new Promise<void>(resolve => { setImmediate(resolve) })

  const server = servers[servers.length - 1]
  if (server === undefined) {
    throw new Error('the route was never mounted: registerRoute did not wait for webServer')
  }
  await new Promise<void>(resolve => {
    if (server.listening) { resolve(); return }
    server.once('listening', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server has no port')
  return {
    url: `http://127.0.0.1:${address.port}/worktree/api`,
    createdWorkspaces,
    createdSessions,
    attachedSessions,
    failWorkspace,
    failSession,
    failAttach,
  }
}

/**
 * Call one route method.
 * @param harness - the mounted route.
 * @param method - route method name.
 * @param body - JSON request body.
 * @returns the status and decoded body.
 */
async function call(harness: Harness, method: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${harness.url}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe('/worktree/api', () => {
  it('creates a checkout, registers its project, and starts a session inside it', async () => {
    const { root, scratch } = repository()
    const harness = await mount()
    const target = join(scratch, 'agent-wt')

    const response = await call(harness, 'start', { cwd: root, branch: 'agent', path: target })
    expect(response.status).toBe(200)
    const worktree = response.body.worktree as { path: string; branch: string }
    expect(worktree.branch).toBe('agent')
    // The session's cwd is the checkout, which is what makes it a separate
    // project with its own sandbox and shell working directory.
    expect(harness.createdWorkspaces).toEqual([realpathSync(target)])
    expect(harness.createdSessions).toEqual([{ cwd: realpathSync(target) }])
    // The registry owns membership; without this the Session renders ungrouped
    // and the GUI's workspace picker has no Workspace to name.
    expect(harness.attachedSessions).toEqual(['session-1'])
    expect(response.body.sessionId).toBe('session-1')
  })

  it('keeps the checkout when the session cannot join its workspace', async () => {
    const { root, scratch } = repository()
    const harness = await mount()
    harness.failAttach.value = true
    const target = join(scratch, 'unattached')

    const response = await call(harness, 'start', { cwd: root, branch: 'unattached', path: target })
    expect(response.status).toBe(500)
    const message = String((response.body.error as { message: string }).message)
    expect(message).toContain('[attach]')
    expect(message).toContain('session-1')
    // The Session is live in this checkout, so the rollback that removes a
    // checkout after a failed start would delete a directory in use.
    expect(existsSync(target)).toBe(true)
  })

  it('removes the checkout when the workspace registration fails', async () => {
    const { root, scratch } = repository()
    const harness = await mount()
    harness.failWorkspace.value = true
    const target = join(scratch, 'orphan')

    const response = await call(harness, 'start', { cwd: root, branch: 'orphan', path: target })
    expect(response.status).toBe(500)
    expect(harness.createdSessions).toEqual([])
    // A failed start must leave the filesystem as it was.
    expect(existsSync(target)).toBe(false)
  })

  it('removes the checkout when the session cannot be started', async () => {
    const { root, scratch } = repository()
    const harness = await mount()
    harness.failSession.value = true
    const target = join(scratch, 'sessionless')

    const response = await call(harness, 'start', { cwd: root, branch: 'sessionless', path: target })
    expect(response.status).toBe(500)
    expect(harness.createdWorkspaces).toHaveLength(1)
    expect(existsSync(target)).toBe(false)
  })

  it('lists the repository worktrees', async () => {
    const { root } = repository()
    const harness = await mount()
    const response = await call(harness, 'list', { cwd: root })
    expect(response.status).toBe(200)
    const worktrees = response.body.worktrees as { main: boolean }[]
    expect(worktrees).toHaveLength(1)
    expect(worktrees[0]!.main).toBe(true)
  })

  it('lists the local branches the picker offers', async () => {
    const { root } = repository()
    git(root, ['branch', 'release'])
    const harness = await mount()
    const response = await call(harness, 'branches', { cwd: root })
    expect(response.status).toBe(200)
    // Both branches point at the fixture's single commit, so only membership is
    // fixed here; the ordering by commit date belongs to the service spec.
    expect(response.body.branches).toHaveLength(2)
    expect(response.body.branches).toEqual(expect.arrayContaining(['main', 'release']))
  })

  it('creates the checkout from a named base branch', async () => {
    const { root, scratch } = repository()
    git(root, ['checkout', '-q', '-b', 'release'])
    git(root, ['commit', '-q', '--allow-empty', '-m', 'release work'])
    const releaseHead = git(root, ['rev-parse', 'HEAD']).trim()
    git(root, ['checkout', '-q', 'main'])
    const harness = await mount()
    const target = join(scratch, 'based')

    const response = await call(harness, 'start', { cwd: root, base: 'release', path: target })
    expect(response.status).toBe(200)
    // The name records the base, so the workspace title and the checkout
    // directory both say where the branch came from.
    expect((response.body.worktree as { branch: string }).branch).toMatch(/^release-\d{6}$/)
    expect(git(target, ['rev-parse', 'HEAD']).trim()).toBe(releaseHead)
  })

  it('rejects an unknown method, a non-POST request, and a malformed body', async () => {
    const harness = await mount()
    expect((await call(harness, 'invented', {})).status).toBe(404)

    const get = await fetch(`${harness.url}/list`, { method: 'GET' })
    expect(get.status).toBe(405)

    const bad = await fetch(`${harness.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(bad.status).toBe(400)
  })

  it('rejects a request without a usable cwd', async () => {
    const harness = await mount()
    const response = await call(harness, 'start', {})
    expect(response.status).toBe(400)
    expect(String((response.body.error as { message: string }).message)).toMatch(/cwd/)
  })

  it('reports a refused branch name without touching the registries', async () => {
    const { root } = repository()
    const harness = await mount()
    const response = await call(harness, 'start', { cwd: root, branch: 'bad name' })
    expect(response.status).toBe(500)
    expect(harness.createdWorkspaces).toEqual([])
  })
})
