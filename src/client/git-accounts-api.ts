/**
 * Browser client of the `/worktree/git/api` Host route.
 *
 * The page never fetches: it is registered with one {@link GitAccountsInjected}
 * face built here, so every call has the same transport, the same refusal
 * handling, and the same rule that a token is only ever written toward the
 * Host. A transport failure is folded into the same result union as a Host
 * refusal, which is what lets the page show a failure where the affected
 * control sits instead of owning an exception path per call.
 * @module @guowenzhang/dsh-worktree/client/git-accounts-api
 */

import {
  GIT_ACCOUNTS_ERROR_CODES,
  type AddAccountResult,
  type GitAccountsErrorCode,
  type GitAccountsInjected,
  type GitAccountsSnapshot,
  type GitIdentity,
  type GitProjectPage,
  type GitRouteResult,
  type GitSshKeysResult,
  type ScanResult,
  type VerifyAccountResult,
} from '../git-accounts/types.ts'

/** The route prefix both halves agree on. */
const ROUTE = '/worktree/git/api'

/**
 * Call one method of the Git-accounts route.
 * @param method - route method name.
 * @param body - JSON request body.
 * @returns the parsed value, or the Host's refusal.
 */
async function gitRequest<T>(method: string, body: Record<string, unknown>): Promise<GitRouteResult<T>> {
  let response: Response
  try {
    response = await fetch(`${ROUTE}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error: unknown) {
    return { ok: false, message: `the Git accounts route is unreachable: ${error instanceof Error ? error.message : String(error)}` }
  }
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A non-JSON body means the request never reached the plugin's handler (the
    // route is not mounted, or a proxy answered); the status is the useful fact.
    return { ok: false, message: `the Git accounts route answered ${response.status} with a non-JSON body` }
  }
  if (!response.ok) {
    const message = readErrorMessage(parsed) ?? `the Git accounts route answered ${response.status}`
    const code = readErrorCode(parsed)
    return { ok: false, message, ...code === undefined ? {} : { code } }
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

/**
 * Read a failure code out of a refusal body, keeping only codes both halves know.
 * @param parsed - the decoded response body.
 * @returns the code, or undefined when the body carries none or an unknown one.
 */
function readErrorCode(parsed: unknown): GitAccountsErrorCode | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined
  const error = (parsed as { error?: unknown }).error
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && (GIT_ACCOUNTS_ERROR_CODES as readonly string[]).includes(code)
    ? code as GitAccountsErrorCode
    : undefined
}

/** The identity the write returns; named here so the face's call types stay readable. */
interface SavedIdentity {
  /** The identity as Git reports it after the write. */
  readonly identity: GitIdentity
}

/**
 * Build the data face the Git-accounts page is registered with.
 *
 * One face is built per plugin activation, and the same object is returned on
 * every injection: a page remount must not need a new transport.
 * @param call - the route call to use; tests pass their own.
 * @returns the page's injected face.
 */
export function createGitAccountsFace(
  call: <T>(method: string, body: Record<string, unknown>) => Promise<GitRouteResult<T>> = gitRequest,
): GitAccountsInjected {
  return {
    snapshot: () => call<GitAccountsSnapshot>('snapshot', {}),
    addAccount: input => call<AddAccountResult>('accounts.add', {
      provider: input.provider,
      host: input.host,
      ...input.auth === undefined ? {} : { auth: input.auth },
      ...input.token === undefined ? {} : { token: input.token },
      ...input.keyPath === undefined ? {} : { keyPath: input.keyPath },
    }),
    verifyAccount: input => call<VerifyAccountResult>('accounts.verify', {
      provider: input.provider,
      host: input.host,
      ...input.auth === undefined ? {} : { auth: input.auth },
      ...input.token === undefined ? {} : { token: input.token },
      ...input.keyPath === undefined ? {} : { keyPath: input.keyPath },
    }),
    sshKeys: () => call<GitSshKeysResult>('ssh.keys', {}),
    removeAccount: id => call<{ readonly removed: true }>('accounts.remove', { id }),
    scan: () => call<ScanResult>('accounts.scan', {}),
    projects: (accountId: string, page: number) => call<GitProjectPage>('projects.list', { accountId, page }),
    saveIdentity: identity => call<SavedIdentity>('identity.set', {
      name: identity.name,
      email: identity.email,
    }),
  }
}
