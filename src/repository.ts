/**
 * Recovery of the main repository root from any checkout of a repository.
 *
 * A linked worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`,
 * so the session that requests a worktree may itself already be running inside
 * one. `git worktree add` must run against the common repository, never against
 * a linked checkout, which is why this module exists as its own step rather
 * than being folded into the command that follows it.
 * @module @guowenzhang/dsh-worktree/repository
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The main repository root containing `checkout`.
 *
 * A `.git` directory means the checkout is itself the main worktree. A `.git`
 * file means a linked worktree: its `gitdir:` target ends in
 * `.git/worktrees/<name>`, and stripping that suffix yields the repository that
 * owns every linked checkout. A `.git` file pointing anywhere else (a
 * submodule, or a checkout whose gitdir was moved) leaves the path unchanged,
 * because the caller's directory is then the best answer available and Git
 * itself will reject an operation that cannot work there.
 * @param checkout - absolute directory to resolve the owning repository of.
 * @returns the main repository root, or `checkout` when it cannot be recovered.
 */
export async function mainRepositoryRoot(checkout: string): Promise<string> {
  const marker = join(checkout, '.git')
  const info = await statOrUndefined(marker)
  if (info === undefined || info.isDirectory()) return checkout
  const text = await readFileOrUndefined(marker)
  if (text === undefined) return checkout
  const recovered = repositoryRootFromGitFile(text)
  if (recovered === undefined) return checkout
  // Git writes the gitdir with forward slashes on every platform, while
  // callers compare this root against paths built by `node:path`. Normalizing
  // here keeps one spelling per host instead of leaking Git's into every
  // consumer.
  return process.platform === 'win32' ? recovered.replace(/\//g, '\\') : recovered
}

/**
 * Derive the repository root from the contents of a `.git` file.
 * @param text - the file's contents.
 * @returns the repository root, or `undefined` when the file names something else.
 */
export function repositoryRootFromGitFile(text: string): string | undefined {
  const target = /^gitdir:[ \t]*(.+?)[ \t\r]*$/m.exec(text)?.[1]
  if (target === undefined) return undefined
  // The pattern consumes `.git/worktrees/<name>`, so its first group is the
  // repository root. The segment count is deliberately exact: a submodule's
  // gitdir lives under `.git/modules/<name>` and must not match.
  const match = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/u.exec(target)
  return match?.[1]
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, { encoding: 'utf8' })
  } catch {
    return undefined
  }
}
