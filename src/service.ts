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
 * @module @guowenzhang/dsh-worktree/service
 */

import { mkdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { runGit } from './git.ts'
import { findNestedCheckouts, findNestedRepositories } from './nested.ts'
import {
  DEFAULT_AGENTS_DIRECTORY, DEFAULT_GIT_TIMEOUT_MS, DEFAULT_NESTED_REPOSITORIES, DEFAULT_NESTED_SCAN_DEPTH,
  DEFAULT_WORKTREE_LAYOUT, type NestedRepositoryPolicy,
} from './policy.ts'
import { parseBranchList, parseWorktreeList, type WorktreeRecord } from './porcelain.ts'
import { mainRepositoryRoot } from './repository.ts'
import {
  agentsWorktreePath,
  assertAbsolutePath,
  assertAgentsDirectory,
  assertBranchName,
  defaultBranchName,
  homeWorktreePath,
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

/**
 * Which of the repositories hanging off a checkout come with it.
 *
 * `none` creates the parent repository's checkout alone, `submodules`
 * materializes the gitlinks the parent records, and `all` also gives every
 * independently nested repository a linked checkout of its own inside the new
 * directory. The choice is deployment policy: `submodules` is what a checkout
 * of a recorded tree owes its caller, while `all` additionally reaches into
 * repositories the parent does not track.
 */
export type { NestedRepositoryPolicy } from './policy.ts'

/** A nested repository's checkout, created together with its parent's. */
export interface NestedWorktree {
  /** Absolute checkout path, inside the parent checkout. */
  readonly path: string
  /** Branch created for it in its own repository. */
  readonly branch: string
  /** Main repository root of the nested repository. */
  readonly repositoryRoot: string
}

/** A completed worktree creation. */
export interface CreatedWorktree extends WorktreeInfo {
  /** Main repository root the checkout was created from. */
  readonly repositoryRoot: string
  /**
   * Nested checkouts created with this one, outermost first. Empty when the
   * policy is `none`, when the repository has no nested repositories, or when
   * it has submodules but the policy materialized none of them.
   */
  readonly nested: readonly NestedWorktree[]
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
  /** User-level `.agents` directory the `home` layout creates checkouts under; defaults to `~/.agents`. */
  readonly homeAgentsDirectory?: string
  /** Which nested repositories come with a checkout; defaults to `none`. */
  readonly nestedRepositories?: NestedRepositoryPolicy
  /** Directory levels searched below a repository root for nested repositories; defaults to 1. */
  readonly nestedScanDepth?: number
}

/**
 * Create, list, and remove linked Git worktrees.
 *
 * Registered as the `worktree` service. Every method resolves the main
 * repository from the caller's directory first, so a session already running
 * inside a linked worktree still operates on the repository that owns it.
 */
export class WorktreeService {
  private timeoutMs: number
  private defaultPath: WorktreeLayout
  private agentsDirectory: string
  private homeAgentsDirectory: string
  private nestedRepositories: NestedRepositoryPolicy
  private nestedScanDepth: number

  /**
   * @param options - git bound, the layout a default path is derived from, and the nested-repository policy.
   * @throws {Error} when `agentsDirectory` cannot be a workspace-relative directory, or `nestedScanDepth` is not a positive integer.
   */
  constructor(options: WorktreeServiceOptions = {}) {
    this.timeoutMs = 0
    this.defaultPath = 'agents'
    this.agentsDirectory = '.agents/worktree'
    this.homeAgentsDirectory = join(homedir(), '.agents')
    this.nestedRepositories = 'none'
    this.nestedScanDepth = 1
    this.reconfigure(options)
  }

  /**
   * Replace the policy every later call runs under.
   *
   * A deployment's settings are live: the fields this service reads are
   * editable while it runs, so they are read at the moment each call uses them.
   * Replacing them here — rather than rebuilding the registration — keeps the
   * service identity every consumer already holds. Validation matches the
   * constructor's, so a policy that could not have been constructed cannot be
   * installed afterwards either.
   * @param options - the complete new policy; an omitted field reverts to its default.
   * @throws {Error} when a field cannot be a worktree policy.
   */
  reconfigure(options: WorktreeServiceOptions = {}): void {
    const agentsDirectory = options.agentsDirectory ?? DEFAULT_AGENTS_DIRECTORY
    const nestedScanDepth = options.nestedScanDepth ?? DEFAULT_NESTED_SCAN_DEPTH
    assertAgentsDirectory(agentsDirectory)
    if (!Number.isSafeInteger(nestedScanDepth) || nestedScanDepth < 1) {
      throw new Error(`nestedScanDepth must be a positive integer: ${JSON.stringify(nestedScanDepth)}`)
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
    this.defaultPath = options.defaultPath ?? DEFAULT_WORKTREE_LAYOUT
    this.agentsDirectory = agentsDirectory
    this.homeAgentsDirectory = options.homeAgentsDirectory ?? join(homedir(), '.agents')
    this.nestedRepositories = options.nestedRepositories ?? DEFAULT_NESTED_REPOSITORIES
    this.nestedScanDepth = nestedScanDepth
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
    const checkout = await canonical(created.path)
    // Nested repositories come over only once the parent's directory exists:
    // every one of their checkouts is a directory inside it.
    const nested: NestedWorktree[] = []
    try {
      if (this.nestedRepositories !== 'none') await this.attachSubmodules(checkout)
      if (this.nestedRepositories === 'all') await this.attachRepositories(repositoryRoot, checkout, nested)
    } catch (error: unknown) {
      await this.rollback(repositoryRoot, checkout, nested, error)
    }
    return {
      path: checkout,
      branch: created.branch,
      head: created.head,
      main: false,
      repositoryRoot,
      nested,
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
   * Remove one linked worktree, together with the nested checkouts inside it.
   *
   * The requested path is matched against the repository's own listing before
   * it becomes a git argument, so a path the model invented cannot reach
   * `git worktree remove`. The main worktree is refused: removing it would
   * delete the repository itself.
   *
   * Nested checkouts are removed first, and each is held to the same rule as
   * the caller's own checkout: they are worktrees of OTHER repositories, whose
   * records would survive with their directories gone if the parent's
   * directory were removed first. Local work is checked before anything is
   * destroyed, so a refusal leaves every checkout in place.
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
    const nested = await findNestedCheckouts(target.path, this.nestedScanDepth)
    // The nested directories are this checkout's own untracked content, so the
    // caller's checkout is judged without them: they are checked on their own
    // and removed before it.
    const nestedPaths = nested.map(entry => relativeFrom(target.path, entry.path))
    await this.assertRemovable(target.path, nestedPaths, request.force)
    for (const entry of [...nested].reverse()) {
      await this.assertRemovable(entry.path, [], request.force)
      await this.removeCheckout(entry.repositoryRoot, entry.path, request.force)
    }
    await this.removeCheckout(repositoryRoot, target.path, request.force)
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
    if (this.defaultPath === 'sibling') return siblingWorktreePath(repositoryRoot, branch)
    if (this.defaultPath === 'home') return homeWorktreePath(this.homeAgentsDirectory, branch)
    return agentsWorktreePath(workspacePath, branch, this.agentsDirectory)
  }

  /**
   * Materialize the submodules one checkout records.
   *
   * `git worktree add` creates each gitlink as an empty directory, so a checkout
   * of a repository with submodules is incomplete without this step. Git keeps
   * every worktree's submodule git directory under that worktree's own
   * administrative entry, so materializing them here leaves the checkouts the
   * caller already had untouched.
   * @param checkout - the checkout to populate.
   */
  private async attachSubmodules(checkout: string): Promise<void> {
    if (!await isFile(join(checkout, '.gitmodules'))) return
    await this.git(checkout, ['submodule', 'update', '--init', '--recursive'])
  }

  /**
   * Attach one linked checkout per repository nested inside the caller's.
   *
   * Each nested repository is its own repository with its own branch space, so
   * its checkout is created the same way the caller's was: a new branch named
   * after the branch it currently holds, based on that branch. The checkout
   * path mirrors the nested repository's place under the original repository
   * root, which puts it inside the new checkout where the original directory
   * was — the path is what makes the copied tree recognizable.
   * @param repositoryRoot - repository root the nested repositories are found under.
   * @param checkout - the parent checkout the nested ones are created inside.
   * @param created - collects each nested creation, in creation order.
   */
  private async attachRepositories(
    repositoryRoot: string,
    checkout: string,
    created: NestedWorktree[],
  ): Promise<void> {
    for (const nested of await findNestedRepositories(repositoryRoot, this.nestedScanDepth)) {
      const target = join(checkout, ...nested.relative.split('/'))
      const base = await this.currentBranch(nested.root)
      const branch = defaultBranchName(base === DETACHED_HEAD ? undefined : base)
      await mkdir(dirname(target), { recursive: true })
      await this.git(nested.root, [
        'worktree', 'add', '-b', branch, target, ...base === DETACHED_HEAD ? [] : [base],
      ])
      created.push({ path: target, branch, repositoryRoot: nested.root })
    }
  }

  /**
   * The branch one repository's own checkout holds.
   * @param repositoryRoot - repository root to read.
   * @returns the short branch name, or `HEAD` for a detached or unborn HEAD.
   */
  private async currentBranch(repositoryRoot: string): Promise<string> {
    return (await this.git(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  }

  /**
   * Undo a creation whose nested repositories could not all be attached.
   *
   * The caller asked for the whole tree or nothing, so every checkout this call
   * created is removed — nested ones first, because each was created inside the
   * one before it. A cleanup that itself fails is reported beside the original
   * failure rather than replacing it: a directory left behind is a fact the
   * caller has to act on, and the reason the creation failed is still the
   * reason.
   * @param repositoryRoot - main repository root of the caller's checkout.
   * @param checkout - the parent checkout to remove.
   * @param nested - the nested creations to remove, in creation order.
   * @param cause - the failure being reported.
   * @throws {Error} always, carrying the cause.
   */
  private async rollback(
    repositoryRoot: string,
    checkout: string,
    nested: readonly NestedWorktree[],
    cause: unknown,
  ): Promise<never> {
    const failures: string[] = []
    for (const entry of [...nested].reverse()) {
      try {
        await this.git(entry.repositoryRoot, ['worktree', 'remove', '--force', entry.path])
      } catch (error: unknown) {
        failures.push(`${entry.path} (${reason(error)})`)
        await this.pruneQuietly(entry.repositoryRoot)
      }
    }
    try {
      await this.git(repositoryRoot, ['worktree', 'remove', '--force', checkout])
    } catch (error: unknown) {
      failures.push(`${checkout} (${reason(error)})`)
      await this.pruneQuietly(repositoryRoot)
    }
    if (failures.length > 0) {
      throw new Error(`${reason(cause)}; cleanup also failed for ${failures.join(', ')}`)
    }
    throw cause
  }

  /**
   * Refuse to remove a checkout that holds work nobody has committed.
   *
   * Git's own removal rule is the same one, but Git cannot state it for a
   * checkout it refuses outright (see {@link removeCheckout}), so the rule is
   * applied here where the caller can read it. Paths the caller is about to
   * remove first are excluded from the caller's own checkout, because they are
   * other repositories' work and are judged on their own.
   * @param checkout - the checkout being removed.
   * @param excluded - repository-relative paths inside it that this removal also removes.
   * @param force - the caller's explicit permission to discard local work.
   * @throws {Error} naming the checkout and how much work is at stake.
   */
  private async assertRemovable(checkout: string, excluded: readonly string[], force: boolean | undefined): Promise<void> {
    if (force === true) return
    const pathspecs = ['.', ...excluded.map(path => `:(exclude,literal)${path}`)]
    const raw = await this.git(checkout, ['status', '--porcelain', '--untracked-files=normal', '--', ...pathspecs])
    const changes = raw.trim()
    if (changes === '') return
    throw new Error(
      `refusing to remove ${JSON.stringify(checkout)}: it has uncommitted work `
      + `(${String(changes.split('\n').length)} path(s)); pass force to remove it anyway`,
    )
  }

  /**
   * Remove one checkout from the repository that owns it.
   *
   * Git refuses to remove any worktree holding a materialized submodule, clean
   * or not, so such a checkout is removed with force — its local work has
   * already been checked by the caller. Every other checkout is offered to Git
   * unchanged, so Git's own refusals (a locked worktree, an unexpected state)
   * still stand.
   * @param repositoryRoot - main repository root that owns the checkout.
   * @param path - the checkout to remove.
   * @param force - the caller's explicit permission to discard local work.
   */
  private async removeCheckout(repositoryRoot: string, path: string, force: boolean | undefined): Promise<void> {
    const forced = force === true || await this.hasSubmodules(path)
    await this.git(repositoryRoot, ['worktree', 'remove', ...forced ? ['--force'] : [], path])
  }

  /**
   * Whether any submodule of one checkout is materialized.
   * @param checkout - the checkout to inspect.
   * @returns true when at least one submodule directory holds a checkout.
   */
  private async hasSubmodules(checkout: string): Promise<boolean> {
    if (!await isFile(join(checkout, '.gitmodules'))) return false
    const raw = await this.git(checkout, ['submodule', 'status', '--recursive'])
    return raw.split('\n').some(line => line.trim().length > 0 && !line.startsWith('-'))
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
 * Express one path relative to another, with `/` separators.
 * @param root - directory the result is relative to.
 * @param path - path to express.
 * @returns the relative path as Git's pathspecs spell it.
 */
function relativeFrom(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/**
 * Describe a caught failure for a diagnostic.
 * @param error - a caught failure.
 * @returns its message, or its string form.
 */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The abbreviation Git prints for a HEAD that names no branch. */
const DETACHED_HEAD = 'HEAD'

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

/**
 * Whether a path names an existing regular file.
 * @param path - candidate file.
 * @returns true when the path is an existing file.
 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error: unknown) {
    // Absence is the answer this predicate reports, not a failure.
    void error
    return false
  }
}
