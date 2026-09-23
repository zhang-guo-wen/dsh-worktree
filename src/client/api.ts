/**
 * Browser client of the `/worktree/api` Host route.
 *
 * The route carries the one operation this plugin's UI needs that no generic
 * Remote exposes: create a checkout, register its project, and start a session
 * in it. Everything else (listing workspaces, opening a session) goes through
 * the composed client services.
 * @module @zhang-guo-wen/dsh-worktree/client/api
 */

/** The route prefix both halves agree on. */
const ROUTE = '/worktree/api'

/** One checkout, as the route lists it. */
export interface WorktreeEntry {
  /** Absolute checkout path. */
  readonly path: string
  /** Short branch name, or `HEAD` for a detached checkout. */
  readonly branch: string
  /** Commit currently checked out. */
  readonly head: string
  /** Whether this checkout is the main worktree of its repository. */
  readonly main: boolean
}

/** A successful `start` result. */
export interface StartResult {
  /** The checkout that was created. */
  readonly worktree: WorktreeEntry & { readonly repositoryRoot: string }
  /** Project registered for the checkout. */
  readonly workspaceId: string
  /** Session started inside it. */
  readonly sessionId: string
}

/** A successful `list` result. */
export interface ListResult {
  /** The repository's live checkouts, main worktree first. */
  readonly worktrees: WorktreeEntry[]
}

/** A successful `branches` result. */
export interface BranchList {
  /** The repository's local branch names, most recently committed first. */
  readonly branches: string[]
}

/** The result of one route call. */
export type RouteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

/**
 * Call one method of the worktree route.
 * @param method - route method name.
 * @param body - JSON request body.
 * @returns the parsed value, or the Host's refusal text.
 */
export async function request<T>(
  method: 'start' | 'list' | 'branches',
  body: Record<string, unknown>,
): Promise<RouteResult<T>> {
  let response: Response
  try {
    response = await fetch(`${ROUTE}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error: unknown) {
    return { ok: false, message: `the worktree route is unreachable: ${error instanceof Error ? error.message : String(error)}` }
  }
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    // A non-JSON body means the request never reached the plugin's handler
    // (a proxy error page, or the route unmounted); surfacing the status is
    // more useful than a parse failure.
    return { ok: false, message: `the worktree route answered ${response.status} with a non-JSON body` }
  }
  if (!response.ok) {
    const message = readErrorMessage(parsed) ?? `the worktree route answered ${response.status}`
    return { ok: false, message }
  }
  return { ok: true, value: parsed as T }
}

/**
 * Read the error text out of a refusal body.
 * @param parsed - the decoded response body.
 * @returns the message, or undefined when the body carries none.
 */
function readErrorMessage(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined
  const error = (parsed as { error?: unknown }).error
  if (error === null || typeof error !== 'object') return undefined
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.length > 0 ? message : undefined
}
