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
 * That notification is necessary but not sufficient. The registry dispatches it
 * only when the archive is asked to stop running work
 * (`archiveSession(id, { stopActivity: true })`, the "stop and archive" flow);
 * the ordinary archive of an idle session — the sidebar's own action, and the
 * common case — writes the durable archive set and notifies nobody. Waiting for
 * an event that path never sends is what left an archived session's checkout and
 * backups on disk.
 *
 * The write itself is announced, though: the registry's state lives in the
 * `workspace` storage domain, and the storage layer emits `domain/changed` for
 * every global write **after the backend acknowledged durability**. That is the
 * archive notification this module was missing, so the cleanup is triggered by
 * it and by `workspace/session-stop` — two listeners, no polling.
 *
 * **Neither trigger is retroactive.** The archives already in the set when a
 * host starts stay untouched: they happened while that host was not watching,
 * and deleting them would carry out an archive this process never saw. Only an
 * archive that arrives while the process runs is cleaned up — which is exactly
 * the case the missing notification used to drop.
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
// Type-only: pulls the `domain/changed` event declaration into this program.
// The storage layer announces every durable write through it, which is the
// archive notification the workspace registry itself does not dispatch.
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { WorktreeService } from './service.ts'
import type { FileGuard } from './file-guard.ts'

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

/**
 * The storage domain whose global singleton carries the archive set.
 *
 * The registry opens it once (`workspaceDomainSpec`), so every durable write of
 * `archivedSessionIds` is announced as a `domain/changed` put on this domain.
 */
const WORKSPACE_DOMAIN = 'workspace'

/** Deployment choices this module's wiring takes. */
export interface ArchiveCleanupWiring {
  /**
   * Whether an archived session's linked checkout is removed. Off leaves every
   * checkout in place — backups still end with their session, because the two
   * are separate promises.
   */
  readonly removeCheckouts?: boolean
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
 * Wire post-archive cleanup into one Host context.
 *
 * Registration rides the plugin's fiber: unloading the plugin removes the two
 * listeners and nothing else — no checkout is touched by disposal.
 * @param ctx - the Host plugin context.
 * @param service - the worktree capability doing the removal.
 * @param guard - the file guard whose per-session backups end with the session.
 * @param wiring - whether archived sessions' linked checkouts are removed.
 */
export function installArchiveCleanup(
  ctx: Context,
  service: WorktreeService,
  guard?: FileGuard,
  wiring: ArchiveCleanupWiring = {},
): void {
  const removeCheckouts = wiring.removeCheckouts ?? true
  let pending = Promise.resolve()
  /** Serialize cleanups: two archives landing together must not race on one registry. */
  const serialize = (work: () => Promise<void>): void => {
    pending = pending.then(work, work).catch((error: unknown) => {
      ctx.logger?.warn?.(`dsh-worktree: post-archive cleanup failed: ${String(error)}`)
    })
  }
  ctx.inject(['workspaceRegistry'], (scope: Context) => {
    const registry = scope.workspaceRegistry as unknown as WorkspaceRegistryLike
    /**
     * Sessions this process has already cleaned up for.
     *
     * Seeded with the set this process started with, which is deliberately not
     * its to clean: an archive that happened while no host was running is the
     * user's own history, and deleting it when the next host starts would carry
     * out a decision nobody made in that session. Only an archive that arrives
     * while this process runs is acted on.
     */
    const handled = new Set<string>(registry.archivedSessionIds.map(String))
    // Only failures observed during this installation are eligible for retry.
    const pendingBackups = new Set<string>()
    const cleanBackups = async (): Promise<void> => {
      for (const id of pendingBackups) {
        if (!registry.archivedSessionIds.some(archivedId => String(archivedId) === id)) {
          pendingBackups.delete(id)
          continue
        }
        try {
          await guard?.archive(id)
          pendingBackups.delete(id)
        } catch (error: unknown) {
          scope.logger?.warn?.(`dsh-worktree: could not clean backups for archived session ${JSON.stringify(id)}: ${reason(error)}`)
        }
      }
    }
    /**
     * End the backups — and the checkout — of every archive that arrived since
     * the previous call.
     *
     * Backups end with the session that took them; the checkout goes with them,
     * because this process watched that archive happen. An id that left the set —
     * unarchived — is forgotten, so a later archive of the same session is a new
     * arrival.
     */
    const cleanArrived = async (): Promise<void> => {
      const archived = new Set(registry.archivedSessionIds.map(String))
      for (const id of handled) {
        if (archived.has(id)) continue
        handled.delete(id)
        pendingBackups.delete(id)
        guard?.resume(id)
      }
      const arrived = [...archived].filter(id => !handled.has(id))
      for (const id of arrived) {
        handled.add(id)
        pendingBackups.add(id)
      }
      await cleanBackups()
      if (removeCheckouts) await reconcile(scope, service, registry, arrived as SessionId[])
    }
    scope.effect(
      () => scope.on('domain/changed', (change) => {
        // The archive write itself. A plain archive dispatches no
        // `workspace/session-stop` — that notification belongs to stopping work —
        // but it does write the registry's global singleton, and the domain
        // announces every durable write. The payload is not read: the registry's
        // own archive set is the authority on what is archived.
        if (change.domain !== WORKSPACE_DOMAIN) return
        if (change.operation !== 'put' || change.table !== '' || change.key !== '') return
        serialize(async () => {
          // Storage emits before registry.setState resumes its await and updates
          // the registry snapshot. A microtask alone can still see the old set.
          await new Promise<void>(resolve => { setImmediate(resolve) })
          await cleanArrived()
        })
      }),
      'dsh-worktree: clean up a session as soon as its archive is durable',
    )
    scope.effect(
      () => scope.on('workspace/session-stop', ({ sessionId }: ArchiveCleanupOptions) => {
        // This notification requests cancellation in parallel; it does not
        // await turn settlement. FileGuard closes protection on archive so late
        // work cannot recreate backups after this sweep.
        serialize(async () => {
          if (!registry.archivedSessionIds.some(id => String(id) === String(sessionId))) return
          pendingBackups.add(String(sessionId))
          await cleanBackups()
          if (removeCheckouts) await reconcile(scope, service, registry, [sessionId])
        })
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
