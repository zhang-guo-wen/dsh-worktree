/**
 * Browser half of the archive flow's second notice: which removals get a banner.
 *
 * The Host removes an archived Session's checkout by itself (see
 * `../archive-cleanup.ts`), so this half never asks for it — it reports what
 * happened, as a notice of its own beside the Workspace surface's "Session
 * archived" toast. The two are independent by construction: this one reads only
 * what the Host already recorded, so nothing it renders can delay, fail, or
 * undo the archive.
 *
 * A Workspace row disappearing is the only Client-side signal there is, and it
 * is ambiguous on its own: deleting a registration never deletes files, and a
 * user may delete a row by hand. The route's `checkout` probe settles it —
 * `removed` and `kept` are this plugin's own archive cleanup and get a banner,
 * `unknown` is a row the user dropped and stays silent.
 *
 * This module is the pure half: no React, no harness UI imports, so its cases
 * run in the self-contained suite (`tests/checkout-notice.spec.ts`). The seat
 * that renders the queue is `checkout-notice.tsx`.
 *
 * @module @guowenzhang/dsh-worktree/client/checkout-notice-store
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CheckoutProbeResult } from './api.ts'

/** One Workspace row as this module reads it. */
export interface NoticedWorkspace {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly SessionId[]
}

/** The Workspace source this module follows: the list the sidebar renders. */
export interface WorkspacesFace {
  readonly list: {
    getSnapshot(): {
      readonly items: readonly NoticedWorkspace[]
      readonly archivedSessionIds: readonly SessionId[]
    }
    subscribe(listener: () => void): () => void
  }
}

/**
 * Asks the Host what the archive flow did to one checkout path.
 * @param path - the canonical checkout path.
 * @returns the outcome the Host recorded for that path.
 */
export type CheckoutProbe = (path: string) => Promise<CheckoutProbeResult>

/**
 * The banner queue, structurally.
 *
 * Narrower than the store the seat binds on purpose: the observer only reads
 * and replaces the queue, so a case that drives it needs no store engine.
 */
export interface NoticeQueue {
  getSnapshot(): readonly CheckoutNotice[]
  set(next: CheckoutNotice[]): void
}

/** One banner waiting to be shown. */
export interface CheckoutNotice {
  /** Monotone per-show key, so re-showing the same text restarts the banner. */
  readonly seq: number
  /** Canonical checkout path the archive flow acted on. */
  readonly path: string
  /** `removed` is the success banner; `kept` reports the refusal. */
  readonly outcome: 'removed' | 'kept'
  /** The Host's refusal text, for a `kept` outcome. */
  readonly reason?: string
}

/**
 * Follow the Workspace list and publish one notice per removal the Host made.
 *
 * The baseline is seeded from the first snapshot without reporting anything:
 * there is no predecessor to compare against, and a Client mounts long after
 * the removals an earlier session caused.
 * @param workspaces - the Workspace list to follow.
 * @param probe - asks the Host what happened to a path whose row disappeared.
 * @param notices - the queue the seat renders.
 * @returns a disposer that unsubscribes and suppresses late answers.
 */
export function observeCheckouts(
  workspaces: WorkspacesFace,
  probe: CheckoutProbe,
  notices: NoticeQueue,
): () => void {
  let disposed = false
  let seq = 0
  let previous = new Map<string, NoticedWorkspace>()
  const seed = workspaces.list.getSnapshot()
  for (const item of seed.items) previous.set(item.workspaceId, item)
  const archived = new Set(seed.archivedSessionIds.map(String))

  const unsubscribe = workspaces.list.subscribe(() => {
    if (disposed) return
    const snapshot = workspaces.list.getSnapshot()
    // Adopt the archive set this snapshot carries BEFORE judging a row: the
    // sessions whose archive removed it arrived in the same frame that dropped
    // the row. Reading the previous set would miss exactly the removal this
    // observer exists to report.
    for (const id of snapshot.archivedSessionIds) archived.add(String(id))
    const rows = new Map(snapshot.items.map(item => [item.workspaceId, item]))
    const disappeared: string[] = []
    for (const [id, before] of previous) {
      if (rows.has(id)) continue
      // Only the archive ends a checkout, so a row whose Sessions were never
      // archived is a registration the user dropped: no removal to report.
      if (before.sessionIds.length === 0) continue
      if (before.sessionIds.every(session => archived.has(String(session)))) disappeared.push(before.path)
    }
    previous = rows
    for (const path of disappeared) {
      void probe(path).then((answer) => {
        if (disposed || answer.outcome === 'unknown') return
        seq += 1
        notices.set([...notices.getSnapshot(), {
          seq,
          path,
          outcome: answer.outcome,
          ...answer.reason === undefined ? {} : { reason: answer.reason },
        }])
      }).catch(() => { /* a Host that cannot answer reports nothing */ })
    }
  })

  return () => { disposed = true; unsubscribe() }
}
