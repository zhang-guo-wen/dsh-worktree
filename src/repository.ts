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
 * The main repository that owns a linked checkout, when `checkout` is one.
 *
 * A linked worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`,
 * which is what makes the owning repository recoverable from the checkout
 * alone. A `.git` file pointing anywhere else is not a linked worktree: a
 * submodule's gitdir lives under `.git/modules/<name>`, and a checkout whose
 * gitdir was moved names a directory this module cannot interpret, so both
 * answer undefined rather than a guess.
 * @param checkout - absolute directory to resolve the owning repository of.
 * @returns the main repository root, or undefined when the directory is not a linked worktree.
 */
export async function linkedWorktreeOwner(checkout: string): Promise<string | undefined> {
  const marker = join(checkout, '.git')
  const info = await statOrUndefined(marker)
  if (info === undefined || info.isDirectory()) return undefined
  const text = await readFileOrUndefined(marker)
  if (text === undefined) return undefined
  const recovered = repositoryRootFromGitFile(text)
  if (recovered === undefined) return undefined
  // Git writes the gitdir with forward slashes on every platform, while
  // callers compare this root against paths built by `node:path`. Normalizing
  // here keeps one spelling per host instead of leaking Git's into every
  // consumer.
  return process.platform === 'win32' ? recovered.replace(/\//g, '\\') : recovered
}

/**
 * The main repository root containing `checkout`.
 *
 * A linked worktree's `.git` is a file naming `<main>/.git/worktrees/<name>`,
 * so the session that requests a worktree may itself already be running inside
 * one. `git worktree add` must run against the common repository, never against
 * a linked checkout, which is why this module exists as its own step rather
 * than being folded into the command that follows it.
 * @param checkout - absolute directory to resolve the owning repository of.
 * @returns the main repository root, or `checkout` when it cannot be recovered.
 */
export async function mainRepositoryRoot(checkout: string): Promise<string> {
  return await linkedWorktreeOwner(checkout) ?? checkout
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
