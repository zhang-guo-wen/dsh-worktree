/**
 * Post-archive cleanup: archiving a session removes the linked checkout it ran in.
 *
 * A worktree exists to isolate one line of work, so the session's own lifecycle
 * is what should end the checkout — not a separate manual removal the user has
 * to remember. The trigger is the Workspace registry's own archive
 * notification: `workspace/session-stop` is dispatched after the archive set is
 * durable, which is exactly when a checkout may be removed without resurrecting
 * anything.
 *
 * Three constraints shape the rest of this module.
 *
 * 1. **A dirty checkout is never removed.** The service applies its own
 *    refusal (uncommitted work, or an unknown checkout) and this module records
 *    the refusal instead of forcing the removal: archiving ends the session, it
 *    does not authorize discarding work.
 * 2. **Cleanup never blocks the archive.** The notification is observed, not
 *    intercepted; every failure is logged against the session and the archive
 *    itself stays committed.
 * 3. **The plugin registers no model-facing tools.** This is the only automatic
 *    removal path, and it runs from Host lifecycle rather than from a tool call.
 *
 * A checkout shared by more than one session is left alone while any of those
 * sessions is unarchived; the registry global archive set is the membership
 * test, so no separate bookkeeping is needed.
 *
 * @module @guowenzhang/dsh-worktree/archive-cleanup
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorktreeService } from './service.ts'

/**
 * What the archive flow did to one checkout, kept for the browser half.
 *
 * The removal is invisible where the user stands: the Workspace row is gone
 * either way, so a Client that only sees rows cannot tell a removed directory
 * from a kept one, nor from a row the user deleted by hand. This record is that
 * answer, and it is recorded by the only component that knows it.
 */
export interface ArchiveProbe {
  /** `removed` — the checkout is gone; `kept` — removal was refused or failed. */
  readonly outcome: 'removed' | 'kept'
  /** The refusal's own text, for a `kept` outcome. */
  readonly reason?: string
}

/**
 * Latest outcome per checkout path.
 *
 * In-memory on purpose: it answers a banner that follows the archive by
 * seconds, so it needs no durability, and dropping it only costs a missing
 * banner — never a wrong one. The entry is cleared when a later attempt at the
 * same path overwrites it (`kept` then `removed`, or the reverse).
 */
const archiveProbes = new Map<string, ArchiveProbe>()

/** Record what the archive flow did to one checkout. */
export function rememberArchiveOutcome(path: string, outcome: ArchiveProbe): void {
  archiveProbes.set(path, outcome)
}

/**
 * Answer what happened to a checkout path whose Workspace row is gone.
 * @param path - the canonical checkout path.
 * @returns the recorded outcome, or `unknown` when this path saw no removal.
 */
export function probeArchiveOutcome(path: string): ArchiveProbe | { readonly outcome: 'unknown' } {
  return archiveProbes.get(path) ?? { outcome: 'unknown' }
}

/** Drop every recorded outcome; the spec suite's isolation hook. */
export function clearArchiveOutcomes(): void {
  archiveProbes.clear()
}


/** The one Workspace-registry notification this module consumes. */
export interface ArchiveCleanupOptions {
  /** Session whose work was just stopped because it was archived. */
  readonly sessionId: SessionId
}

/** The narrow view of the workspace registry this module needs. */
interface WorkspaceRegistryLike {
  readonly archivedSessionIds: readonly SessionId[]
  list(): readonly WorkspaceLike[]
  delete(id: WorkspaceId): Promise<boolean>
}

/** The narrow view of one workspace entity. */
interface WorkspaceLike {
  readonly id: WorkspaceId
  readonly path: string
  readonly sessionIds: readonly SessionId[]
}

/** The narrow view of the session store this module needs. */
interface SessionsLike {
  get(id: SessionId): { header: { cwd?: string } } | undefined
}

/**
 * Wire post-archive checkout removal into one Host context.
 *
 * Registration rides the plugin's fiber: unloading the plugin removes the
 * notification and nothing else — no checkout is touched by disposal.
 * @param ctx - the Host plugin context.
 * @param service - the worktree capability doing the removal.
 */
export function installArchiveCleanup(ctx: Context, service: WorktreeService): void {
  let pending = Promise.resolve()
  /** Serialize sweeps: two archives landing together must not race on one registry. */
  const serialize = (work: () => Promise<void>): void => {
    pending = pending.then(work, work).catch((error: unknown) => {
      ctx.logger?.warn?.(`dsh-worktree: post-archive cleanup failed: ${String(error)}`)
    })
  }
  ctx.inject(['workspaceRegistry'], (scope: Context) => {
    const registry = scope.workspaceRegistry as unknown as WorkspaceRegistryLike
    scope.effect(
      () => scope.on('workspace/session-stop', ({ sessionId }: ArchiveCleanupOptions) => {
        // Read the archived set after the notification returns, so removal sees
        // the set the archive just made durable.
        serialize(() => reconcile(scope, service, registry, [sessionId]))
      }),
      'dsh-worktree: remove the checkout of an archived session',
    )
  })
}

/**
 * Remove the checkout of every session in `sessionIds` that is archived.
 * @param ctx - context for the session store and the logger.
 * @param service - the worktree capability.
 * @param registry - the workspace registry.
 * @param sessionIds - session ids to consider; extra ids are ignored.
 */
async function reconcile(
  ctx: Context,
  service: WorktreeService,
  registry: WorkspaceRegistryLike,
  sessionIds: readonly SessionId[],
): Promise<void> {
  const archived = new Set<string>(registry.archivedSessionIds)
  if (archived.size === 0) return
  const sessions = ctx.get('sessions') as SessionsLike | undefined
  for (const sessionId of sessionIds) {
    if (!archived.has(String(sessionId))) continue
    const workspace = findWorkspace(registry, sessionId, sessions)
    if (workspace === undefined) continue
    // The session that permanently ended the checkout is the only one whose
    // archive may remove it: a subagent shares its parent's cwd, and archiving
    // the child must not delete the workspace its parent is still working in.
    if (!archived.has(String(workspace.sessionIds[0]))) continue
    await discard(ctx, service, registry, workspace)
  }
}

/**
 * Locate the workspace a session belongs to.
 *
 * The session's own header cwd is the authoritative answer when it is still
 * live; after the session is gone, the registry's accounting is.
 * @param registry - the workspace registry.
 * @param sessionId - the session to locate.
 * @param sessions - the live session store, when the host has one.
 * @returns the workspace, or undefined when the session is accounted nowhere.
 */
function findWorkspace(
  registry: WorkspaceRegistryLike,
  sessionId: SessionId,
  sessions: SessionsLike | undefined,
): WorkspaceLike | undefined {
  const cwd = sessions?.get(sessionId)?.header.cwd
  const normalized = cwd === undefined ? undefined : normalize(cwd)
  return registry.list().find(workspace => (
    normalized !== undefined && normalize(workspace.path) === normalized
  ) || workspace.sessionIds.some(id => String(id) === String(sessionId)))
}

/**
 * Remove one archived session's linked checkout and its workspace registration.
 * @param ctx - context for the logger.
 * @param service - the worktree capability.
 * @param registry - the workspace registry.
 * @param workspace - the workspace whose checkout should go.
 */
async function discard(
  ctx: Context,
  service: WorktreeService,
  registry: WorkspaceRegistryLike,
  workspace: WorkspaceLike,
): Promise<void> {
  let checkout
  try {
    checkout = await service.inspectLinkedCheckout(workspace.path)
  } catch (error: unknown) {
    ctx.logger?.warn?.(`dsh-worktree: could not inspect ${JSON.stringify(workspace.path)} after archiving: ${reason(error)}`)
    return
  }
  if (checkout === undefined) return
  try {
    await service.remove({ cwd: checkout.repositoryRoot, path: checkout.path })
  } catch (error: unknown) {
    // The service refuses a checkout with uncommitted work, and a checkout that
    // is already gone is nothing to clean up. Both are logged, not fatal: the
    // archive is durable and the checkout stays where the user can see it. The
    // browser half reports the outcome, so it is recorded rather than only logged.
    const failure = reason(error)
    rememberArchiveOutcome(checkout.path, { outcome: 'kept', reason: failure })
    ctx.logger?.warn?.(`dsh-worktree: kept ${JSON.stringify(checkout.path)} after archiving its session: ${failure}`)
    return
  }
  rememberArchiveOutcome(checkout.path, { outcome: 'removed' })
  try {
    await registry.delete(workspace.id)
  } catch (error: unknown) {
    // The checkout is gone either way, so the second notice still says so; only
    // the Workspace row survives, and the log names it.
    ctx.logger?.warn?.(`dsh-worktree: removed ${JSON.stringify(checkout.path)} but could not drop its workspace record: ${reason(error)}`)
  }
}

/** Compare two paths by identity rather than spelling, matching the service's canon. */
function normalize(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/** Describe a caught failure for a diagnostic. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
