/**
 * The `/worktree/api` Host route.
 *
 * Starting a session inside a new worktree is one operation, not three: the
 * checkout, its workspace record, and the session must appear together or not
 * at all, because a session whose cwd is a checkout the workspace registry does
 * not own shows up as an ungrouped orphan, and a checkout whose session was
 * never created is an invisible directory the user has to find and clean up by
 * hand. The route therefore owns the ordering and the rollback.
 *
 * Ordering is forced by the workspace registry: a session joins a workspace
 * only when its header cwd canonicalizes to that workspace's path, and a
 * mismatch fails loud, so the checkout must exist before the workspace record
 * and the workspace record before the session.
 * @module @zhang-guo-wen/dsh-worktree/route
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { startSessionIn } from './session.ts'
import type { WorktreeService } from './service.ts'

/** Request body of the `start` method. */
interface StartRequest {
  /** Directory whose repository the worktree is created in. */
  readonly cwd?: unknown
  /** Branch name; omitted means a generated one. */
  readonly branch?: unknown
  /** Checkout directory; omitted means a sibling of the repository. */
  readonly base?: unknown
  /** Agent preset the session is composed from. */
  readonly agentPreset?: unknown
}

/** A refusal that carries the HTTP status the route answers with. */
class RouteError extends Error {
  /**
   * @param status - HTTP status to answer with.
   * @param message - model- and user-facing reason.
   */
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'RouteError'
  }
}

/**
 * Read a JSON request body.
 * @param req - the incoming request.
 * @returns the parsed body, or an empty object for an empty body.
 * @throws {RouteError} when the body is not valid JSON.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RouteError(400, 'request body must be a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof RouteError) throw error
    throw new RouteError(400, 'request body is not valid JSON')
  }
}

/**
 * Write a JSON response.
 * @param res - the response to write.
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

/**
 * Require one body field to be a non-empty string.
 * @param value - the raw field.
 * @param field - field name, for the diagnostic.
 * @returns the validated string.
 * @throws {RouteError} when the field is absent or not a non-empty string.
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RouteError(400, `${field} must be a non-empty string`)
  }
  return value
}

/**
 * Register the `/worktree/api` route.
 *
 * Registration waits for the services the route's handler reads — `webServer`,
 * `workspaceRegistry`, and `agents` — through `ctx.inject` rather than reading
 * them once with `ctx.get`: plugin activation order is not guaranteed, so a
 * host that activates this plugin before the webserver would otherwise see
 * `undefined` and never mount the route. The declaration is also what makes the
 * properties readable: a service provided by a sibling plugin is reachable only
 * from a context that declares it. Waiting also re-mounts the route if a
 * service is replaced, and the registration rides the plugin's fiber so it
 * disappears on unload. A deployment missing one of the three keeps the
 * model-facing tools and mounts no route, rather than one whose start fails at
 * the first missing service.
 * @param ctx - the Host plugin context.
 * @param service - the worktree capability.
 */
export function registerRoute(ctx: Context, service: WorktreeService): void {
  ctx.inject(['webServer', 'workspaceRegistry', 'agents'], (scope: Context) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: '/worktree/api',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        let stage = 'dispatch'
        try {
          if (req.method !== 'POST') throw new RouteError(405, 'method not allowed')
          const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice('/worktree/api/'.length)
          const body = await readJsonBody(req)
          if (method === 'start') {
            writeJson(res, 200, await start(scope, service, body, (next) => { stage = next }))
            return
          }
          if (method === 'list') {
            stage = 'list'
            writeJson(res, 200, { worktrees: await service.list(requireString(body.cwd, 'cwd')) })
            return
          }
          if (method === 'branches') {
            stage = 'branches'
            writeJson(res, 200, { branches: await service.listBranches(requireString(body.cwd, 'cwd')) })
            return
          }
          throw new RouteError(404, `unknown worktree API method ${JSON.stringify(method)}`)
        } catch (error: unknown) {
          const status = error instanceof RouteError ? error.status : 500
          // The stage names which step failed. Without it a bare 500 from an
          // inner service is indistinguishable from a failure in this handler.
          const detail = error instanceof Error ? error.message : String(error)
          const message = `[${stage}] ${detail}`
          scope.logger?.error?.(`dsh-worktree: ${message}`)
          writeJson(res, status, { error: { message, stage } })
        }
      },
    }), 'dsh-worktree: /worktree/api route')
  })
}

/**
 * Create a checkout, register it as a workspace, and start a session in it.
 *
 * Rollback covers the two failure points that follow a successful checkout: a
 * workspace record that cannot be created, and a session that cannot be
 * started. The checkout is removed in both cases so a failed start leaves the
 * filesystem as it was; if that removal also fails, the error names the
 * directory so the user can remove it rather than being left with silence.
 * @param ctx - Host context carrying the workspace registry and agent registry.
 * @param service - the worktree capability.
 * @param body - the request body.
 * @returns the created checkout, workspace id, and session id.
 */
async function start(
  ctx: Context,
  service: WorktreeService,
  body: Record<string, unknown>,
  onStage: (stage: string) => void,
): Promise<unknown> {
  const cwd = requireString(body.cwd, 'cwd')
  const branch = body.branch === undefined ? undefined : requireString(body.branch, 'branch')
  const base = body.base === undefined ? undefined : requireString(body.base, 'base')
  const path = body.path === undefined ? undefined : requireString(body.path, 'path')
  const agentPreset = body.agentPreset === undefined ? undefined : requireString(body.agentPreset, 'agentPreset')

  onStage('worktree')
  const created = await service.create({
    cwd,
    ...branch === undefined ? {} : { branch },
    ...base === undefined ? {} : { base },
    ...path === undefined ? {} : { path },
  })

  let workspaceId: string
  let attachSession: (sessionId: string) => Promise<void>
  onStage('workspace')
  try {
    const workspace = await ctx.workspaceRegistry.create(created.path, `${workspaceTitle(created.repositoryRoot, created.branch)}`)
    workspaceId = workspace.id
    attachSession = async (sessionId) => { await workspace.attachSession(SessionId(sessionId)) }
  } catch (error: unknown) {
    await discard(ctx, service, cwd, created.path, error)
    throw error
  }

  let sessionId: string
  onStage('session')
  try {
    sessionId = await startSessionIn(ctx, created.path, agentPreset)
  } catch (error: unknown) {
    await discard(ctx, service, cwd, created.path, error)
    throw error
  }

  // A Session belongs to a Workspace only through the registry's own ledger: a
  // checkout the registry does not account this Session under renders as an
  // ungrouped Session with no Workspace for the GUI's picker to name.
  onStage('attach')
  try {
    await attachSession(sessionId)
  } catch (error: unknown) {
    // The checkout and the Session are both live and the Session's header cwd is
    // the checkout, so the rollback used above would remove a directory this
    // request just put a Session in. The failure names what survives instead.
    const reason = error instanceof Error ? error.message : String(error)
    throw new RouteError(500,
      `session ${JSON.stringify(sessionId)} was started in ${JSON.stringify(created.path)} but could not attach `
      + `to workspace ${JSON.stringify(workspaceId)}: ${reason}`)
  }

  return {
    worktree: created,
    workspaceId,
    sessionId,
  }
}

/**
 * Build the workspace title for a new checkout.
 * @param repositoryRoot - the repository the checkout belongs to.
 * @param branch - the branch checked out.
 * @returns a title naming both, so two worktrees of one repository are distinguishable.
 */
function workspaceTitle(repositoryRoot: string, branch: string): string {
  const name = repositoryRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? repositoryRoot
  return `${name} · ${branch}`
}

/**
 * Remove a checkout after a later step of the same start failed.
 * @param ctx - Host context, for the logger.
 * @param service - the worktree capability.
 * @param cwd - the directory the removal is resolved from.
 * @param path - the checkout to remove.
 * @param cause - the failure being reported, kept as the primary error.
 */
async function discard(
  ctx: Context,
  service: WorktreeService,
  cwd: string,
  path: string,
  cause: unknown,
): Promise<void> {
  try {
    await service.remove({ cwd, path, force: true })
  } catch (error: unknown) {
    // The original failure is what the caller must act on; a failed cleanup
    // additionally names the directory that survived, because silently leaving
    // a checkout behind would be worse than a second line in the log.
    const reason = error instanceof Error ? error.message : String(error)
    ctx.logger?.warn?.(`dsh-worktree: could not remove ${JSON.stringify(path)} after a failed start (${reason}); `
      + `original failure: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
