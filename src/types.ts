/**
 * The `worktree` service declaration.
 *
 * Declaring the service name on `Context` is what lets a Host consumer write
 * `ctx.worktree` under cordis's injection guard instead of reaching through
 * `ctx.get('worktree')` and narrowing an `undefined` at each call site.
 * @module @guowenzhang/dsh-worktree/types
 */

import type { WorktreeService } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The worktree capability provided by this package. */
    worktree: WorktreeService
  }
}
