/**
 * The `/worktree/git/api` Host route: Git accounts, the Git identity, the
 * machine scan, and project pages.
 *
 * This route is separate from `/worktree/api` because it answers a different
 * deployment question. The worktree route needs the workspace registry and the
 * agent registry; this one needs only the webserver and whatever credential
 * provider the deployment configured, so a host that could run one of them can
 * still run the other. The account page's data face is entirely on this route;
 * the browser half calls it through `src/client/git-accounts-api.ts`.
 *
 * Methods: `snapshot`, `accounts.add`, `accounts.verify`, `accounts.remove`,
 * `accounts.scan`, `ssh.keys`, `projects.list`, `identity.set`; all POST + JSON
 * body, and a failure answers `{ error: { message, code, stage } }` with `stage`
 * naming the method.
 *
 * No method accepts a host path, returns a token, or returns a private key's
 * contents: a token or a key path goes in, and only summaries come out.
 * @module @guowenzhang/dsh-worktree/git-accounts/route
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { GitAccountsError, GitAccountsService, statusForAccountsError } from './accounts.ts'
import type { GitAuthMethod } from './types.ts'

/** Route prefix both halves agree on. */
const ROUTE_PREFIX = '/worktree/git/api'

/** A request failure that carries the HTTP status this route answers with. */
class RouteError extends Error {
  /**
   * @param status - HTTP status to answer with.
   * @param message - user-facing reason.
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
 * @throws {RouteError} when the body is not a JSON object.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RouteError(400, 'request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RouteError(400, 'request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
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
 * Require one body field to be a string.
 * @param value - the raw field.
 * @param field - field name, for the diagnostic.
 * @returns the string, empty allowed where the operation accepts a cleared value.
 * @throws {RouteError} when the field is absent or not a string.
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new RouteError(400, `${field} must be a string`)
  return value
}

/**
 * Require one body field to be a non-empty string.
 * @param value - the raw field.
 * @param field - field name, for the diagnostic.
 * @returns the string.
 * @throws {RouteError} when the field is absent or empty.
 */
function requireNonEmptyString(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (text.length === 0) throw new RouteError(400, `${field} must be a non-empty string`)
  return text
}

/**
 * Require one body field to be a positive page number.
 * @param value - the raw field.
 * @returns the page number.
 * @throws {RouteError} when the field is not a positive integer.
 */
function requirePage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new RouteError(400, 'page must be a positive integer')
  }
  return value
}

/**
 * Register the Git-accounts route.
 *
 * Registration waits for `webServer` through `ctx.inject`, exactly like the
 * worktree route, so activation order does not decide whether the page works.
 * A deployment without a webserver simply has no HTTP surface for this
 * capability; the plugin keeps its other surfaces.
 * @param ctx - the Host plugin context.
 * @param service - the Git-accounts capability.
 */
export function registerGitAccountsRoute(ctx: Context, service: GitAccountsService): void {
  ctx.inject(['webServer'], (scope: Context) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        let stage = 'dispatch'
        try {
          if (req.method !== 'POST') throw new RouteError(405, 'method not allowed')
          const method = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice(`${ROUTE_PREFIX}/`.length)
          stage = method
          const body = await readJsonBody(req)
          writeJson(res, 200, await dispatch(service, method, body))
        } catch (error: unknown) {
          const status = error instanceof RouteError ? error.status
            : error instanceof GitAccountsError ? statusForAccountsError(error.code)
              : 500
          const message = error instanceof Error ? error.message : String(error)
          const code = error instanceof GitAccountsError ? error.code : undefined
          scope.logger?.error?.(`dsh-worktree: [${stage}] ${message}`)
          writeJson(res, status, { error: { message: `[${stage}] ${message}`, stage, ...code === undefined ? {} : { code } } })
        }
      },
    }), 'dsh-worktree: /worktree/git/api route')
  })
}

/**
 * Dispatch one route method.
 * @param service - the Git-accounts capability.
 * @param method - path below the route prefix.
 * @param body - decoded request body.
 * @returns the method's JSON result.
 * @throws {RouteError} when the method is unknown.
 */
async function dispatch(service: GitAccountsService, method: string, body: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'snapshot':
      return await service.snapshot()
    case 'accounts.add':
      return await service.add({
        provider: requireNonEmptyString(body.provider, 'provider'),
        host: requireNonEmptyString(body.host, 'host'),
        ...body.auth === undefined ? {} : { auth: requireString(body.auth, 'auth') },
        ...body.token === undefined ? {} : { token: requireString(body.token, 'token') },
        ...body.keyPath === undefined ? {} : { keyPath: requireString(body.keyPath, 'keyPath') },
        origin: 'manual',
      })
    case 'accounts.verify':
      return await service.verifyAccount({
        provider: requireNonEmptyString(body.provider, 'provider'),
        host: requireNonEmptyString(body.host, 'host'),
        ...body.auth === undefined ? {} : { auth: requireString(body.auth, 'auth') as GitAuthMethod },
        ...body.token === undefined ? {} : { token: requireString(body.token, 'token') },
        ...body.keyPath === undefined ? {} : { keyPath: requireString(body.keyPath, 'keyPath') },
      })
    case 'accounts.remove':
      return await service.remove(requireNonEmptyString(body.id, 'id'))
    case 'accounts.scan':
      return await service.scan()
    case 'ssh.keys':
      return await service.listSshKeys()
    case 'projects.list':
      return await service.projects(requireNonEmptyString(body.accountId, 'accountId'), requirePage(body.page))
    case 'identity.set':
      return await service.saveIdentity({
        name: requireString(body.name, 'name'),
        email: requireString(body.email, 'email'),
      })
    default:
      throw new RouteError(404, `unknown Git accounts API method ${JSON.stringify(method)}`)
  }
}
