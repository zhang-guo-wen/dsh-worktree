/**
 * The branch-name rule, shared by the Host validator and the browser surface.
 *
 * Both halves refuse an unusable name, and they must refuse exactly the same
 * names: a picker that accepted what the Host rejects would fail after the user
 * committed to it, and a Host that accepted what Git rejects would fail mid
 * `git worktree add`. This module is that single rule.
 * @module @guowenzhang/dsh-worktree/branch-rule
 */

/** Characters and sequences `git check-ref-format --branch` rejects. */
const INVALID = /[\u0000-\u001f\u007f ~^:?*[\\]|\.\.|\/\/|^\/|\/$|\.$|^\.|@\{/

/**
 * Whether a name is usable as a new branch.
 * @param branch - candidate branch name.
 * @returns true when the name is one Git would accept.
 */
export function branchIsValid(branch: string): boolean {
  if (branch.length === 0 || branch === '@') return false
  if (branch.startsWith('-')) return false
  if (branch.endsWith('.lock')) return false
  return !INVALID.test(branch)
}
