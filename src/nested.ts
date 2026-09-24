/**
 * Discovery of the repositories that hang off one repository's checkout.
 *
 * Two kinds of child repository can live inside a checkout, and Git treats them
 * differently. A submodule is a gitlink the parent records: `git worktree add`
 * creates its mount point as an EMPTY directory and leaves materializing it to
 * `git submodule update`. An independent nested repository is one the parent
 * does not track at all — the parent's checkout has no such directory, so only
 * the original checkout can name it, and this module is what finds it there.
 *
 * Both searches walk real directories only: a symlinked child is not descended
 * into, which keeps a junction in the tree from turning the walk into a loop.
 * @module @guowenzhang/dsh-worktree/nested
 */

import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { linkedWorktreeOwner } from './repository.ts'

/** Directory names never walked: Git's own metadata, and the dependency tree no repository owns. */
const SKIPPED = new Set(['.git', 'node_modules'])

/** A repository nested inside another repository's checkout. */
export interface NestedRepository {
  /** Absolute path of the nested repository's own main checkout. */
  readonly root: string
  /** Its path relative to the repository it was found under, with `/` separators. */
  readonly relative: string
}

/** A linked worktree of another repository, found inside a checkout. */
export interface NestedCheckout {
  /** Absolute path of the linked checkout. */
  readonly path: string
  /** The main repository that owns it, which is where it must be removed from. */
  readonly repositoryRoot: string
}

/**
 * Find the repositories nested inside one repository's checkout.
 *
 * Only a directory carrying a `.git` DIRECTORY is reported: that is a
 * repository of its own. A directory whose `.git` is a file is either a
 * submodule (materialized by the submodule step, never by a second worktree) or
 * a linked worktree of some other repository (its own checkout already exists
 * elsewhere), and neither is a repository this search may create a branch in.
 *
 * The walk descends through a repository it just reported, so a repository
 * nested inside a nested one is found too, and the result is ordered parents
 * before children — which is the order their checkouts must be created in,
 * because every child's directory is inside its parent's.
 * @param root - absolute path of the repository root to search.
 * @param maxDepth - directory levels below `root` to search; 1 is the direct children.
 * @returns the nested repositories, outermost first.
 */
export async function findNestedRepositories(root: string, maxDepth: number): Promise<NestedRepository[]> {
  const found: NestedRepository[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    for (const entry of await readableEntries(directory)) {
      if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue
      const child = join(directory, entry.name)
      if (await hasGitDirectory(child)) {
        found.push({ root: child, relative: relativeTo(root, child) })
      }
      await visit(child, depth + 1)
    }
  }
  await visit(root, 1)
  return found
}

/**
 * Find the linked worktrees of other repositories inside one checkout.
 *
 * This is the removal half of {@link findNestedRepositories}: the checkouts a
 * creation made are recognized by their `.git` file naming a repository's
 * `.git/worktrees` entry, and each is removed from the repository that owns it.
 * @param root - absolute path of the checkout to search.
 * @param maxDepth - directory levels below `root` to search; 1 is the direct children.
 * @returns the nested checkouts, outermost first.
 */
export async function findNestedCheckouts(root: string, maxDepth: number): Promise<NestedCheckout[]> {
  const found: NestedCheckout[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    for (const entry of await readableEntries(directory)) {
      if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue
      const child = join(directory, entry.name)
      const owner = await linkedWorktreeOwner(child)
      if (owner !== undefined) found.push({ path: child, repositoryRoot: owner })
      await visit(child, depth + 1)
    }
  }
  await visit(root, 1)
  return found
}

/**
 * A directory's entries, or none when it cannot be read.
 * @param directory - directory to list.
 * @returns its entries, empty when the directory is unreadable.
 */
async function readableEntries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch (error: unknown) {
    // An unreadable directory contributes nothing to the search, and the
    // search only informs a creation that has its own failure to report.
    void error
    return []
  }
}

/**
 * Whether a directory carries its own Git metadata directory.
 * @param directory - candidate directory.
 * @returns true when `<directory>/.git` is a directory.
 */
async function hasGitDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(join(directory, '.git'))).isDirectory()
  } catch (error: unknown) {
    // Absence is this predicate's answer, not a failure.
    void error
    return false
  }
}

/**
 * Express one path relative to another with `/` separators.
 * @param root - directory the result is relative to.
 * @param path - path to express.
 * @returns the relative path, `/`-separated on every platform.
 */
function relativeTo(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}
