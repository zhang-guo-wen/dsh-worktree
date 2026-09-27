/**
 * The Git process edge.
 *
 * Every git invocation in this plugin goes through {@link runGit}, which is the
 * single place a child process is spawned and the single place an exit code is
 * turned into a failure. Callers pass already-validated absolute paths and
 * already-validated branch names; this module adds no policy of its own beyond
 * never invoking a shell.
 * @module @guowenzhang/dsh-worktree/git
 */

import { execFile } from 'node:child_process'

/** A git invocation that exited nonzero, carrying Git's own diagnostic. */
export class GitCommandError extends Error {
  /**
   * @param args - the git arguments that failed, for the diagnostic text.
   * @param cwd - the directory the command ran in.
   * @param stderr - Git's stderr, trimmed.
   */
  constructor(
    readonly args: readonly string[],
    readonly cwd: string,
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')} failed in ${cwd}: ${stderr}`)
    this.name = 'GitCommandError'
  }
}

/**
 * Run one git command and return its stdout.
 *
 * The command runs without a shell, so no argument is ever re-parsed by a
 * shell and a path containing spaces or metacharacters stays a single
 * argument. A nonzero exit rejects with {@link GitCommandError}; a successful
 * exit resolves with stdout exactly as Git wrote it (porcelain consumers
 * depend on the raw bytes, including their trailing newline).
 * @param cwd - directory to run in.
 * @param args - git arguments, excluding the leading `git`.
 * @returns the command's stdout.
 * @throws {GitCommandError} when git exits nonzero.
 */
export async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    execFile('git', [...args], { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolvePromise(stdout)
        return
      }
      rejectPromise(new GitCommandError(args, cwd, stderr.trim() || error.message))
    })
  })
}

/**
 * Whether a directory is inside a Git working tree.
 * @param cwd - absolute directory to test.
 * @returns true when `git rev-parse` finds a work tree.
 */
export async function isGitWorkTree(cwd: string): Promise<boolean> {
  try {
    return (await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch (error: unknown) {
    // A non-repository directory is the answer this predicate reports, not a
    // failure. `execFile` also rejects when git is absent from PATH, and a
    // caller that cannot run git has no work tree to inspect either.
    void error
    return false
  }
}
