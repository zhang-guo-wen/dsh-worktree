/**
 * Real-git coverage for the worktree capability.
 *
 * Every case builds a scratch repository on disk and drives the service
 * through actual `git` processes, because the behavior under test is the
 * interaction with Git's administrative records — porcelain output, the
 * `.git/worktrees` layout, and refusal semantics — and a stubbed git would
 * assert the stub instead.
 *
 * Each case owns its scratch directory and removes it in a `finally`, so the
 * suite is safe beside other forked specs.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeService } from '../src/service.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-worktree-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-worktree-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

/** Scratch directories created by the current case, removed on teardown. */
const created: string[] = []

afterEach(() => {
  for (const path of created.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

/**
 * Run git in a fixture and return stdout.
 * @param cwd - directory to run in.
 * @param args - git arguments.
 * @param env - extra environment, for cases that need distinct commit dates.
 * @returns the command's stdout.
 */
function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY, ...env },
  })
}

/**
 * Create a repository with one commit and a `main` branch.
 * @returns the repository root and a scratch parent directory.
 */
function repository(): { root: string; scratch: string } {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-worktree-')))
  created.push(scratch)
  const root = join(scratch, 'repo')
  git(scratch, ['init', '-q', '-b', 'main', root])
  writeFileSync(join(root, 'tracked.txt'), 'base\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])
  return { root, scratch }
}

describe('WorktreeService against real git', () => {
  it('creates a worktree, reports it in the listing, and removes it', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    const target = join(scratch, 'agent worktree')

    const createdWorktree = await service.create({ cwd: root, branch: 'agent', path: target })
    expect(createdWorktree.branch).toBe('agent')
    expect(createdWorktree.repositoryRoot).toBe(realpathSync(root))
    expect(resolve(createdWorktree.path)).toBe(resolve(realpathSync(target)))
    // The checkout is a real directory holding the committed file and its own
    // HEAD, which is what makes it usable as a session workspace.
    expect(existsSync(join(createdWorktree.path, 'tracked.txt'))).toBe(true)

    const listed = await service.list(root)
    expect(listed).toHaveLength(2)
    expect(listed[0]).toMatchObject({ main: true, branch: 'main' })
    expect(listed[1]).toMatchObject({ main: false, branch: 'agent' })

    const removed = await service.remove({ cwd: root, path: createdWorktree.path })
    expect(removed.branch).toBe('agent')
    expect(existsSync(createdWorktree.path)).toBe(false)
    expect(await service.list(root)).toHaveLength(1)
  })

  it('accepts a path spelling that differs from the one git recorded', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    const target = join(scratch, 'linked')
    const createdWorktree = await service.create({ cwd: root, branch: 'linked', path: target })

    // A trailing separator names the same directory, so removal must match it
    // through path identity rather than string equality.
    await expect(service.remove({ cwd: root, path: `${createdWorktree.path}\\` })).resolves
      .toMatchObject({ branch: 'linked' })
  })

  it('refuses to remove the main worktree', async () => {
    const { root } = repository()
    const service = new WorktreeService()
    await expect(service.remove({ cwd: root, path: root })).rejects
      .toThrow(/refusing to remove the main worktree/)
  })

  it('refuses a path the repository does not list', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    await expect(service.remove({ cwd: root, path: join(scratch, 'invented') })).rejects
      .toThrow(/unknown worktree/)
  })

  it('refuses to remove a dirty worktree without force, and removes it with force', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    const createdWorktree = await service.create({ cwd: root, branch: 'dirty', path: join(scratch, 'dirty') })
    writeFileSync(join(createdWorktree.path, 'tracked.txt'), 'modified\n')

    await expect(service.remove({ cwd: root, path: createdWorktree.path })).rejects.toThrow()
    await expect(service.remove({ cwd: root, path: createdWorktree.path, force: true })).resolves
      .toMatchObject({ branch: 'dirty' })
    expect(existsSync(createdWorktree.path)).toBe(false)
  })

  it('resolves the main repository when the caller is inside a linked worktree', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    const first = await service.create({ cwd: root, branch: 'first', path: join(scratch, 'first') })

    // A session already running inside a worktree must still create its next
    // worktree against the repository that owns both, not against the linked
    // checkout.
    const second = await service.create({ cwd: first.path, branch: 'second', path: join(scratch, 'second') })
    expect(second.repositoryRoot).toBe(realpathSync(root))
    expect((await service.list(first.path)).map(entry => entry.branch).sort())
      .toEqual(['first', 'main', 'second'])
  })

  it('bases a new branch on an explicit commit-ish', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    git(root, ['commit', '-q', '--allow-empty', '-m', 'second'])
    const firstCommit = git(root, ['rev-parse', 'HEAD~1']).trim()

    const createdWorktree = await service.create({
      cwd: root, branch: 'from-base', path: join(scratch, 'from-base'), base: firstCommit,
    })
    expect(git(createdWorktree.path, ['rev-parse', 'HEAD']).trim()).toBe(firstCommit)
  })

  it('rejects a branch that already exists without leaving a stale record', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    const target = join(scratch, 'conflict')
    await service.create({ cwd: root, branch: 'taken', path: target })

    await expect(service.create({ cwd: root, branch: 'taken', path: join(scratch, 'conflict-2') }))
      .rejects.toThrow()
    // The failed second creation must not appear as a worktree.
    expect((await service.list(root)).map(entry => entry.branch).sort()).toEqual(['main', 'taken'])
  })

  it('rejects an invalid branch name before any git process runs', async () => {
    const { root } = repository()
    const service = new WorktreeService()
    await expect(service.create({ cwd: root, branch: 'bad name' })).rejects.toThrow(/invalid branch name/)
  })

  it('rejects a relative cwd', async () => {
    const service = new WorktreeService()
    await expect(service.create({ cwd: 'relative/path' })).rejects.toThrow(/must be an absolute path/)
  })

  it('creates the default checkout inside the calling workspace agent directory', async () => {
    const { root } = repository()
    const service = new WorktreeService()
    // The fixture has no agent directory: the default layout creates every
    // missing level, so the first checkout in a workspace does not fail on one.
    expect(existsSync(join(root, '.agents'))).toBe(false)

    const createdWorktree = await service.create({ cwd: root, branch: 'nested' })
    expect(createdWorktree.path).toBe(join(realpathSync(root), '.agents', 'worktree', 'nested'))
    expect(existsSync(join(createdWorktree.path, 'tracked.txt'))).toBe(true)
  })

  it('flattens a branch name into one directory name', async () => {
    const { root } = repository()
    const service = new WorktreeService()
    const createdWorktree = await service.create({ cwd: root, branch: 'dsh/wt-1' })
    expect(createdWorktree.path).toBe(join(realpathSync(root), '.agents', 'worktree', 'dsh-wt-1'))
  })

  it('derives the default checkout from the calling workspace, not the main repository', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService()
    const linked = await service.create({ cwd: root, branch: 'outer', path: join(scratch, 'outer') })

    // A session running inside a linked checkout joins that checkout's own
    // workspace, so its next worktree nests under it rather than under the
    // repository it was branched from.
    const nested = await service.create({ cwd: linked.path, branch: 'inner' })
    expect(nested.path).toBe(join(linked.path, '.agents', 'worktree', 'inner'))
    expect(nested.repositoryRoot).toBe(realpathSync(root))
  })

  it('keeps the sibling layout available beside the repository', async () => {
    const { root, scratch } = repository()
    const service = new WorktreeService({ defaultPath: 'sibling' })
    const createdWorktree = await service.create({ cwd: root, branch: 'beside' })
    expect(createdWorktree.path).toBe(join(scratch, 'repo-wt-beside'))
  })

  it('refuses an agent directory that is not repository-relative', () => {
    for (const agentsDirectory of ['', '/absolute', 'C:\\absolute', '..', '../escape', 'a/../b']) {
      expect(() => new WorktreeService({ agentsDirectory }), agentsDirectory).toThrow(/agentsDirectory/)
    }
  })

  it('lists the local branches, most recently committed first', async () => {
    const { root } = repository()
    const service = new WorktreeService()
    git(root, ['branch', 'older'])
    // Committer dates have one-second resolution, so the newest branch carries a
    // sentinel date instead of the wall clock: the fixture's other commits are
    // made now, and the ordering must not depend on how fast the case runs.
    git(root, ['checkout', '-q', '-b', 'newer'])
    git(root, ['commit', '-q', '--allow-empty', '-m', 'newer commit'],
      { GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2099-01-01T00:00:00Z' })

    expect(await service.listBranches(root)).toEqual(['newer', 'main', 'older'])
  })

  it('bases a new branch on a named local branch and names it after that base', async () => {
    const { root } = repository()
    const service = new WorktreeService()
    git(root, ['checkout', '-q', '-b', 'release'])
    git(root, ['commit', '-q', '--allow-empty', '-m', 'release work'])
    const releaseHead = git(root, ['rev-parse', 'HEAD']).trim()
    git(root, ['checkout', '-q', 'main'])

    const createdWorktree = await service.create({ cwd: root, base: 'release' })
    expect(createdWorktree.branch).toMatch(/^release-\d{6}$/)
    expect(git(createdWorktree.path, ['rev-parse', 'HEAD']).trim()).toBe(releaseHead)
  })

  it('names the fallback stem for a commit-ish that is not a local branch', async () => {
    const { root } = repository()
    const service = new WorktreeService()
    const head = git(root, ['rev-parse', 'HEAD']).trim()

    // A revision expression is not the fact the name is there to record.
    const createdWorktree = await service.create({ cwd: root, base: head })
    expect(createdWorktree.branch).toMatch(/^worktree-\d{6}$/)
    expect(git(createdWorktree.path, ['rev-parse', 'HEAD']).trim()).toBe(head)
  })
})
