/**
 * Which sessions a change-history page covers, and where each one restores into.
 *
 * The file guard keeps one directory of copies per session, so a page that
 * answers "what did this session change" has to name every session whose work
 * belongs to it: the session itself, plus the delegated children it spawned.
 * This module owns both answers.
 *
 * **Where one session restores into.** The copy's relative path is only
 * meaningful against the directory the session actually had. The Host's session
 * store holds the sessions currently live in this process, and the change
 * history can legitimately be opened for a session that is not live: a teammate
 * that has settled, or a child read back from durable history when the app was
 * reopened. The durable store's header is therefore the fallback, and it is the
 * only source for a child that has no live Agent. A session neither source knows
 * has no directory to restore into, and the caller says so instead of guessing.
 *
 * **Which sessions belong to the tree.** The subagent catalog records every
 * delegation a session made, durably and with the label the delegation was
 * given, and the descendant listing walks those catalogs without loading or
 * resuming an Agent. That is deliberately not a parent-header walk: a fork
 * inherits the parent's header lineage but is a separate conversation rather
 * than delegated work, so it must not be swept in. A deployment without the
 * catalog service lists the session alone, and a catalog read that fails is a
 * degrade to the same answer — the page's own copies stay reachable.
 * @module @guowenzhang/dsh-worktree/session-tree
 */

import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute, resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session/types'

/** One session whose copies a page may list, with the directory they restore into. */
export interface BackupOwner {
  /** The session that owns the copies. */
  readonly sessionId: string
  /** Absolute working directory the session's relative copies resolve against. */
  readonly cwd: string
  /** Delegation distance from the page's session: 0 for itself, 1 for a direct child. */
  readonly depth: number
  /** Human label the delegation was created with, present for a delegated child. */
  readonly label?: string
}

/** The page's session and the delegated sessions below it. */
export interface SessionTree {
  /**
   * The session the page was opened for, or undefined when neither the live
   * store nor the durable store can name its working directory.
   */
  readonly root: BackupOwner | undefined
  /** Delegated children and their descendants, in catalog pre-order. */
  readonly descendants: readonly BackupOwner[]
}

/** The Host session store, as far as one live session's directory is needed. */
interface SessionsLike {
  get(id: SessionId): { readonly header: { readonly cwd?: string } } | undefined
}

/** The durable session store, as far as one cold session's header is needed. */
interface SessionPersistenceLike {
  stat(id: SessionId): Promise<{ readonly header: { readonly cwd?: string } } | undefined>
}

/** One row of the subagent catalog traversal. */
interface CatalogDescendantLike {
  /** `child` is a delegated session; `diagnostic` is an unreadable branch. */
  readonly kind: 'child' | 'diagnostic'
  /** Session the row names. */
  readonly id: string
  /** Edge distance from the requested root; direct children are `1`. */
  readonly depth: number
  /** Human label the delegation was created with. */
  readonly label?: string
}

/** Subagent catalog traversal, as far as delegated children are needed. */
interface SubagentsLike {
  listDescendants(rootId: SessionId, signal?: AbortSignal): Promise<readonly CatalogDescendantLike[]>
}

/**
 * Resolve the page's session and its delegated descendants.
 *
 * The descendants are resolved only after the root's directory is known: a
 * session with no directory has no list to extend, and the caller reports that
 * as the page's own outcome.
 * @param ctx - the scope the route handler runs in.
 * @param sessionId - the session the page was opened for.
 * @returns the root when its directory resolves, and the children that also resolve one.
 */
export async function resolveSessionTree(ctx: Context, sessionId: string): Promise<SessionTree> {
  const cwd = await resolveSessionCwd(ctx, sessionId)
  if (cwd === undefined) return { root: undefined, descendants: [] }
  return { root: { sessionId, cwd, depth: 0 }, descendants: await resolveDescendants(ctx, sessionId) }
}

/**
 * The working directory one session runs in.
 *
 * Read from the Host's stores, never from the request: a copy's relative path is
 * only meaningful against the directory the session actually had, and a
 * caller-supplied one could point a restore at another file with the same tail.
 * The live store answers for a session this process currently holds; the durable
 * store answers for every session it stored, including a stopped teammate.
 * @param ctx - the scope the route handler runs in.
 * @param sessionId - the session whose directory is needed.
 * @returns the absolute working directory, or undefined when no store knows it.
 */
export async function resolveSessionCwd(ctx: Context, sessionId: string): Promise<string | undefined> {
  const sessions = ctx.get('sessions') as SessionsLike | undefined
  const live = directoryOf(sessions?.get(SessionId(sessionId))?.header.cwd)
  if (live !== undefined) return live
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
  if (persistence === undefined) return undefined
  try {
    const stored = await persistence.stat(SessionId(sessionId))
    return directoryOf(stored?.header.cwd)
  } catch (error: unknown) {
    // One unreadable header must not fail the page: a session that cannot be
    // resolved is skipped by the caller, and the rest of the tree still lists.
    ctx.logger?.warn?.(`dsh-worktree: could not read the stored header of session ${JSON.stringify(sessionId)}; `
      + `its working directory is unknown (${reasonOf(error)})`)
    return undefined
  }
}

/**
 * Resolve the delegated sessions below one session, with their directories.
 *
 * The catalog traversal is durable, so a teammate that has stopped is still
 * named here. Rows whose directory cannot be resolved are skipped: a copy under
 * an unknown directory can be neither compared nor restored, and listing it
 * would offer an action the Host cannot carry out.
 * @param ctx - the scope the route handler runs in.
 * @param sessionId - the session whose delegated children are wanted.
 * @returns the resolved children and their descendants, in catalog pre-order.
 */
async function resolveDescendants(ctx: Context, sessionId: string): Promise<readonly BackupOwner[]> {
  const subagents = ctx.get('subagents') as SubagentsLike | undefined
  if (subagents === undefined) return []
  let rows: readonly CatalogDescendantLike[]
  try {
    rows = await subagents.listDescendants(SessionId(sessionId))
  } catch (error: unknown) {
    // The catalog is another service's data; a deployment that cannot read it
    // still has this session's own copies to show.
    ctx.logger?.warn?.(`dsh-worktree: could not list the delegated sessions of ${JSON.stringify(sessionId)}; `
      + `the change history lists this session alone (${reasonOf(error)})`)
    return []
  }
  const owners: BackupOwner[] = []
  for (const row of rows) {
    if (row.kind !== 'child') continue
    const cwd = await resolveSessionCwd(ctx, row.id)
    if (cwd === undefined) continue
    owners.push({
      sessionId: row.id,
      cwd,
      depth: row.depth,
      ...row.label === undefined ? {} : { label: row.label },
    })
  }
  return owners
}

/**
 * Normalize one stored directory, refusing a relative one.
 *
 * A session header's `cwd` is absolute by construction; a value that is not is
 * a record this page cannot resolve against, and resolving it would silently
 * anchor restores to the Host process's directory instead.
 * @param cwd - the stored directory, when the store had one.
 * @returns the platform-normalized absolute directory, or undefined.
 */
function directoryOf(cwd: string | undefined): string | undefined {
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  return isAbsolute(cwd) ? resolve(cwd) : undefined
}

/**
 * One failure's text, for a log line.
 * @param error - whatever was thrown.
 * @returns the message, or the stringified value.
 */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
