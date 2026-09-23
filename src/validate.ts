/**
 * Validation of the model-supplied inputs that become git arguments.
 *
 * Branch names and worktree paths arrive from a tool call, so they are a model
 * boundary: each is checked here before any git invocation, and a value that
 * cannot be a branch name or a checkout directory fails with the reason rather
 * than reaching Git and producing its own opaque message.
 * @module @zhang-guo-wen/dsh-worktree/validate
 */

import { randomInt } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { branchIsValid } from './branch-rule.ts'

/**
 * Assert a value is usable as a new branch name.
 * @param branch - candidate branch name.
 * @throws {Error} naming the violated rule.
 */
export function assertBranchName(branch: string): void {
  if (branch.length === 0) throw new Error('branch name must not be empty')
  if (!branchIsValid(branch)) {
    throw new Error(
      `invalid branch name ${JSON.stringify(branch)}: it is reserved by Git, contains whitespace `
      + 'or a reserved character, or starts with "-"',
    )
  }
}

/**
 * Assert a value is an absolute, normalized path usable as a worktree target.
 * @param path - candidate path.
 * @param label - which input this is, for the diagnostic.
 * @throws {Error} when the path is not absolute or escapes via a parent segment.
 */
export function assertAbsolutePath(path: string, label: string): void {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path: ${JSON.stringify(path)}`)
  }
  const segments = path.split(/[\\/]+/)
  if (segments.includes('..')) {
    throw new Error(`${label} must not contain a ".." segment: ${JSON.stringify(path)}`)
  }
}

/** Where a checkout created without an explicit path goes. */
export type WorktreeLayout = 'agents' | 'sibling'

/**
 * Assert a value is usable as the relative directory the `agents` layout
 * creates checkouts in.
 * @param value - candidate directory.
 * @throws {Error} naming the violated rule.
 */
export function assertAgentsDirectory(value: string): void {
  if (value.length === 0) throw new Error('agentsDirectory must not be empty')
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error(`agentsDirectory must be relative to the workspace: ${JSON.stringify(value)}`)
  }
  if (value.split(/[\\/]+/).includes('..')) {
    throw new Error(`agentsDirectory must not contain a ".." segment: ${JSON.stringify(value)}`)
  }
}

/**
 * Derive the `agents` checkout directory for a branch.
 *
 * The checkout goes inside the calling Workspace's own agent directory, which
 * is where a workspace tree groups it as a child of that Workspace rather than
 * as an unrelated top-level directory.
 * @param workspacePath - the directory the calling Session runs in, which is the Workspace the checkout joins.
 * @param branch - branch the worktree will hold.
 * @param agentsDirectory - directory under the Workspace that holds checkouts.
 * @returns an absolute directory path.
 */
export function agentsWorktreePath(workspacePath: string, branch: string, agentsDirectory: string): string {
  return join(workspacePath, agentsDirectory, flattenBranch(branch))
}

/**
 * Derive the `sibling` checkout directory for a branch: beside the main
 * checkout, named after the repository and the branch.
 * @param repositoryRoot - main repository root.
 * @param branch - branch the worktree will hold.
 * @returns an absolute directory path.
 */
export function siblingWorktreePath(repositoryRoot: string, branch: string): string {
  return join(dirname(repositoryRoot), `${basename(repositoryRoot)}-wt-${flattenBranch(branch)}`)
}

/**
 * Flatten a branch name into one directory name.
 * @param branch - branch the worktree will hold.
 * @returns the branch name with every separator replaced.
 */
function flattenBranch(branch: string): string {
  return branch.replace(/[\\/]+/g, '-')
}

/**
 * Derive the default branch name for a new worktree: the branch it starts from
 * plus a short random suffix.
 *
 * The recorded base is the one fact about a worktree nothing else keeps, and the
 * suffix is what makes two worktrees of one base distinct — the checkout
 * directory is derived from this name, so it must never repeat.
 * @param base - the local branch the new branch starts from, when there is one to record.
 * @returns a branch name Git accepts.
 */
export function defaultBranchName(base?: string): string {
  const stem = base === undefined ? 'worktree' : flattenBranch(base)
  return `${stem}-${randomSuffix()}`
}

/** Digits drawn for the random suffix: one in a million per base. */
const SUFFIX_LENGTH = 6

/**
 * Draw the random suffix of a derived branch name.
 * @returns the requested number of digits, keeping leading zeros.
 */
function randomSuffix(): string {
  let digits = ''
  for (let index = 0; index < SUFFIX_LENGTH; index += 1) digits += String(randomInt(0, 10))
  return digits
}
