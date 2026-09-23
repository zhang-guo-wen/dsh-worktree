/**
 * The worktree capability: create a linked checkout, list the ones that exist,
 * and remove one.
 *
 * This module owns the ordering that makes a worktree usable as a session
 * workspace — resolve the main repository, create the checkout, then report
 * the canonical path the caller will hand to `ctx.agents.create` as
 * `meta.cwd`. It deliberately does not create sessions or workspaces: those
 * are separate consumers of the path this returns, and keeping them out
 * preserves the rule that a capability seam is complete without prescribing
 * its consumers.
 * @module @zhang-guo-wen/dsh-worktree/service
 */

import { mkdir, realpath, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runGit } from './git.ts'
import { parseBranchList, parseWorktreeList, type WorktreeRecord } from './porcelain.ts'
import { mainRepositoryRoot } from './repository.ts'
import {
  agentsWorktreePath,
  assertAbsolutePath,
  assertAgentsDirectory,
  assertBranchName,
  defaultBranchName,
  siblingWorktreePath,
  type WorktreeLayout,
} from './validate.ts'

/** One worktree as reported to callers. */
export interface WorktreeInfo {
  /** Canonical absolute checkout path, the value a session's `meta.cwd` takes. */
  readonly path: string
  /** Short branch name, or `HEAD` for a detached checkout. */
  readonly branch: string
  /** Commit currently checked out. */
  readonly head: string
  /** Whether this checkout is the main worktree of its repository. */
  readonly main: boolean
}

/** A completed worktree creation. */
export interface CreatedWorktree extends WorktreeInfo {
  /** Main repository root the checkout was created from. */
  readonly repositoryRoot: string
}

/** Inputs accepted when creating a worktree. */
export interface CreateWorktreeRequest {
  /** Directory inside the repository to derive the main root from. */
  readonly cwd: string
  /** Branch to create; defaults to the base branch name plus a random suffix. */
  readonly branch?: string
  /** Directory for the checkout; defaults to the configured layout under the caller's directory. */
  readonly path?: string
  /**
   * Commit-ish to base the new branch on; defaults to the repository's HEAD. A
   * local branch among these is also recorded in the default branch name.
   */
  readonly base?: string
}

/** Inputs accepted when removing a worktree. */
export interface RemoveWorktreeRequest {
  /** Directory inside the repository that owns the worktree. */
  readonly cwd: string
  /** Checkout to remove; matched against the repository's own listing. */
  readonly path: string
  /** Remove even when the checkout has modifications or untracked files. */
  readonly force?: boolean
}

/** Deployment policy for {@link WorktreeService}. */
export interface WorktreeServiceOptions {
  /** Bound for each git invocation; a hung git must not hang the turn. */
  readonly timeoutMs?: number
  /** Where a checkout created without an explicit path goes. */
  readonly defaultPath?: WorktreeLayout
  /** Repository-relative directory the `agents` layout creates checkouts in. */
  readonly agentsDirectory?: string
}

/**
 * Create, list, and remove linked Git worktrees.
 *
 * Registered as the `worktree` service. Every method resolves the main
 * repository from the caller's directory first, so a session already running
 * inside a linked worktree still operates on the repository that owns it.
 */
export class WorktreeService {
  private readonly timeoutMs: number
  private readonly defaultPath: WorktreeLayout
  private readonly agentsDirectory: string

  /**
   * @param options - git bound and the layout a default path is derived from.
   * @throws {Error} when `agentsDirectory` cannot be a workspace-relative directory.
   */
  constructor(options: WorktreeServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.defaultPath = options.defaultPath ?? 'agents'
    this.agentsDirectory = options.agentsDirectory ?? '.agents/worktree'
    assertAgentsDirectory(this.agentsDirectory)
  }

  /**
   * Create a linked worktree and return its canonical path.
   *
   * Ordering matters and is the reason this is one method: the branch is
   * asserted before any process starts, the main repository is recovered
   * before `git worktree add` runs (a linked checkout cannot host the command),
   * and the created path is canonicalized through `fs.realpath` before it is
   * returned, because the workspace registry's uniqueness canon is realpath
   * equality and a caller comparing an uncanonicalized path would create a
   * second record for one directory.
   * @param request - the caller's directory plus optional branch, path, and base.
   * @returns the created worktree with its canonical path.
   */
  async create(request: CreateWorktreeRequest): Promise<CreatedWorktree> {
    assertAbsolutePath(request.cwd, 'cwd')
    // A requested name is asserted before any process starts; a derived one is
    // built from the timestamp and a base Git itself reported, so it cannot
    // name anything Git would refuse.
    if (request.branch !== undefined) assertBranchName(request.branch)
    if (request.base !== undefined && request.base.length === 0) {
      throw new Error('base must not be empty when given')
    }
    const repositoryRoot = await mainRepositoryRoot(request.cwd)
    const branch = request.branch
      ?? defaultBranchName(await this.recordedBase(repositoryRoot, request.base))
    const derived = request.path === undefined
    const target = request.path ?? this.defaultTarget(request.cwd, repositoryRoot, branch)
    assertAbsolutePath(target, 'path')
    if (derived) {
      // `git worktree add` creates the checkout itself but not a missing parent,
      // and the agent directory is a convention no run may have created yet.
      // A caller-supplied path stays the caller's responsibility.
      await mkdir(dirname(target), { recursive: true })
    }

    const args = ['worktree', 'add', '-b', branch, target, ...request.base === undefined ? [] : [request.base]]
    try {
      await this.git(repositoryRoot, args)
    } catch (error: unknown) {
      // A failed creation must leave no half-registered checkout behind: Git
      // may have written the administrative entry before failing on the
      // checkout, and a stale entry would surface as a prunable record.
      await this.pruneQuietly(repositoryRoot)
      throw error
    }

    const records = await this.list(repositoryRoot)
    const created = records.find(record => samePath(record.path, target))
      ?? records.find(record => record.branch === branch)
    if (created === undefined) {
      throw new Error(`git reported success creating ${JSON.stringify(target)} but the worktree is not listed`)
    }
    return {
      path: await canonical(created.path),
      branch: created.branch,
      head: created.head,
      main: false,
      repositoryRoot,
    }
  }

  /**
   * List the repository's worktrees, live checkouts only.
   *
   * Prunable records are dropped here rather than reported: they name
   * administrative metadata whose checkout directory has been deleted, so no
   * caller can use them and every caller would have to filter them again.
   * @param cwd - directory inside the repository to list.
   * @returns the live worktrees, main worktree first.
   */
  async list(cwd: string): Promise<WorktreeInfo[]> {
    assertAbsolutePath(cwd, 'cwd')
    const repositoryRoot = await mainRepositoryRoot(cwd)
    const raw = await this.git(repositoryRoot, ['worktree', 'list', '--porcelain', '-z'])
    return parseWorktreeList(raw)
      .filter(record => !record.prunable)
      .map((record, index) => ({
        path: record.path,
        branch: record.branch,
        head: record.head,
        main: index === 0,
      }))
  }

  /**
   * Remove one linked worktree.
   *
   * The requested path is matched against the repository's own listing before
   * it becomes a git argument, so a path the model invented cannot reach
   * `git worktree remove`. The main worktree is refused: removing it would
   * delete the repository itself.
   * @param request - the caller's directory, the checkout to remove, and whether to force.
   * @returns the record that was removed, as it was last listed.
   */
  async remove(request: RemoveWorktreeRequest): Promise<WorktreeInfo> {
    assertAbsolutePath(request.cwd, 'cwd')
    assertAbsolutePath(request.path, 'path')
    const repositoryRoot = await mainRepositoryRoot(request.cwd)
    const records = await this.list(repositoryRoot)
    const requested = await canonical(request.path)
    const target = records.find(record => samePath(record.path, requested))
    if (target === undefined) {
      throw new Error(`unknown worktree of ${JSON.stringify(repositoryRoot)}: ${JSON.stringify(request.path)}`)
    }
    if (target.main) {
      throw new Error(`refusing to remove the main worktree ${JSON.stringify(target.path)}`)
    }
    await this.git(repositoryRoot, [
      'worktree', 'remove', ...request.force === true ? ['--force'] : [], target.path,
    ])
    return target
  }

  /**
   * List the repository's local branches, most recently committed first.
   *
   * Only `refs/heads` is read: a remote-tracking ref or a tag is not a branch a
   * checkout could hold, and `git worktree add` would silently detach HEAD for
   * one.
   * @param cwd - directory inside the repository to list.
   * @returns the short branch names.
   */
  async listBranches(cwd: string): Promise<string[]> {
    assertAbsolutePath(cwd, 'cwd')
    return await this.branchNames(await mainRepositoryRoot(cwd))
  }

  /**
   * The base a derived branch name records, if one is worth recording.
   *
   * A base that names a local branch says where the new branch came from; any
   * other commit-ish is a revision expression (`HEAD~2`, a hash, a remote ref)
   * that a name could only repeat as noise.
   * @param repositoryRoot - main repository root.
   * @param base - the requested commit-ish, when the caller gave one.
   * @returns the base branch name, or undefined when nothing should be recorded.
   */
  private async recordedBase(repositoryRoot: string, base: string | undefined): Promise<string | undefined> {
    if (base === undefined || base === 'HEAD') return undefined
    return (await this.branchNames(repositoryRoot)).includes(base) ? base : undefined
  }

  /**
   * Read one repository's local branch names.
   * @param repositoryRoot - main repository root.
   * @returns the short branch names, most recently committed first.
   */
  private async branchNames(repositoryRoot: string): Promise<string[]> {
    const raw = await this.git(repositoryRoot, [
      'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads',
    ])
    return parseBranchList(raw)
  }

  /**
   * Derive the checkout directory for one creation, under the configured layout.
   * @param workspacePath - the caller's directory, which is the Workspace the checkout joins.
   * @param repositoryRoot - main repository root the checkout is created from.
   * @param branch - branch the worktree will hold.
   * @returns an absolute directory path.
   */
  private defaultTarget(workspacePath: string, repositoryRoot: string, branch: string): string {
    return this.defaultPath === 'sibling'
      ? siblingWorktreePath(repositoryRoot, branch)
      : agentsWorktreePath(workspacePath, branch, this.agentsDirectory)
  }

  /**
   * Run git under this service's configured bound.
   * @param cwd - directory to run in.
   * @param args - git arguments.
   * @returns git's stdout.
   */
  private async git(cwd: string, args: readonly string[]): Promise<string> {
    return await withTimeout(runGit(cwd, args), this.timeoutMs, `git ${args.join(' ')}`)
  }

  /**
   * Drop stale administrative records after a failed creation.
   * @param repositoryRoot - repository whose records are pruned.
   */
  private async pruneQuietly(repositoryRoot: string): Promise<void> {
    try {
      await this.git(repositoryRoot, ['worktree', 'prune'])
    } catch (error: unknown) {
      // The original creation failure is the one the caller must see; a prune
      // that also fails leaves a prunable record, which every reader of this
      // service already filters.
      void error
    }
  }
}

/**
 * Resolve a checkout path to its canonical form.
 *
 * Git reports the path it recorded at creation time, and a caller compares
 * that against the workspace registry's realpath canon; on macOS a temporary
 * directory keeps a `/var` symlink that git resolves to `/private/var`, so the
 * two spellings name one directory and only realpath makes them equal.
 * @param path - candidate directory.
 * @returns the canonical path, or the input when it cannot be resolved.
 */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error: unknown) {
    // The directory is absent or unreadable; the uncanonicalized path is still
    // the most accurate name available for it.
    void error
    return path
  }
}

/**
 * Compare two paths by identity rather than spelling.
 *
 * Git reports checkout paths with forward slashes even on Windows, while a
 * caller's path comes from `node:path` and therefore uses backslashes; the two
 * spellings name one directory. Case is folded on Windows for the same reason.
 * @param left - first path.
 * @param right - second path.
 * @returns true when both name the same location.
 */
function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const trimmed = value.replace(/[\\/]+$/, '').replace(/\\/g, '/')
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
  }
  return normalize(left) === normalize(right)
}

/**
 * Enforce a deadline on one git invocation.
 * @param work - the pending git result.
 * @param timeoutMs - the bound in milliseconds.
 * @param label - what is being awaited, for the failure text.
 * @returns the awaited value.
 * @throws {Error} when the bound elapses first.
 */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) return await work
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, rejectPromise) => {
        timer = setTimeout(() => { rejectPromise(new Error(`${label} timed out after ${timeoutMs}ms`)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Whether a path names an existing directory.
 * @param path - candidate directory.
 * @returns true when the path is an existing directory.
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error: unknown) {
    // Absence is the answer this predicate reports, not a failure.
    void error
    return false
  }
}
