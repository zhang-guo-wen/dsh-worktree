/**
 * Real-git coverage for the repositories a checkout carries with it.
 *
 * A parent repository reaches its children two ways, and both are exercised
 * against actual `git` processes here: a submodule the parent records as a
 * gitlink, and an independent repository nested inside the parent's tree that
 * the parent does not track at all. Each case builds its own scratch world and
 * removes it afterwards, so the suite is safe beside other forked specs.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeService } from '../src/service.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-worktree-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-worktree-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

/**
 * A submodule addressed by a local path cannot be cloned without Git's file
 * transport, which Git refuses for submodule clones by default. The allowance
 * rides the environment the way a user's own global config would — the plugin
 * inherits it and never sets it itself, so this is also what a deployment needs
 * for such a repository.
 */
process.env.GIT_CONFIG_COUNT = '1'
process.env.GIT_CONFIG_KEY_0 = 'protocol.file.allow'
process.env.GIT_CONFIG_VALUE_0 = 'always'

/** Scratch directories created by the current case, removed on teardown. */
const created: string[] = []

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

/**
 * Run git in a fixture and return stdout.
 * @param cwd - directory to run in.
 * @param args - git arguments.
 * @returns the command's stdout.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } })
}

/**
 * Create one repository with a single commit on `main`.
 * @param root - directory the repository is created at.
 * @param file - file committed in it.
 * @param body - that file's contents.
 */
function repositoryAt(root: string, file: string, body: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main', root], { env: { ...process.env, ...IDENTITY } })
  writeFileSync(join(root, file), body)
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])
}

/**
 * A scratch world to build one case's repositories in.
 * @returns the scratch directory, removed on teardown.
 */
function scratchWorld(): string {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-nested-')))
  created.push(scratch)
  return scratch
}

/**
 * A scratch world with one repository root.
 * @param name - directory name of the repository inside the scratch world.
 * @returns the scratch parent and the repository root.
 */
function world(name: string): { scratch: string; root: string } {
  const scratch = scratchWorld()
  const root = join(scratch, name)
  repositoryAt(root, 'tracked.txt', 'parent content\n')
  return { scratch, root }
}

/**
 * A parent repository with a child recorded as a submodule and initialized in
 * the parent's own checkout, which is the state a user's repository is in.
 *
 * The fixture allows the file transport through the environment, because a
 * submodule addressed by a local path cannot be cloned without it — by the
 * parent's own `submodule add` here, and by the worktree this suite creates
 * later.
 * @param scratch - scratch world to build in.
 * @returns the parent root and the submodule's path inside it.
 */
function withSubmodule(scratch: string): { root: string; submodule: string } {
  const child = join(scratch, 'child-lib')
  repositoryAt(child, 'lib.txt', 'child content\n')
  const root = join(scratch, 'parent')
  repositoryAt(root, 'tracked.txt', 'parent content\n')
  git(root, ['submodule', 'add', '-q', child, 'child-sub'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'add submodule'])
  git(root, ['submodule', 'update', '--init'])
  return { root, submodule: join(root, 'child-sub') }
}

describe('nested repositories in a created checkout', () => {
  it('materializes a recorded submodule without disturbing the caller’s checkout', async () => {
    const scratch = scratchWorld()
    const fixture = withSubmodule(scratch)

    const createdWorktree = await new WorktreeService({ nestedRepositories: 'submodules' }).create({
      cwd: fixture.root,
      branch: 'sub', path: join(scratch, 'wt'),
    })

    expect(readdirSync(join(createdWorktree.path, 'child-sub')).sort()).toEqual(['.git', 'lib.txt'])
    expect(createdWorktree.nested).toEqual([])
    // The caller's own checkout keeps its submodule: the new checkout's
    // submodule git directory belongs to that worktree alone.
    expect(existsSync(join(fixture.submodule, 'lib.txt'))).toBe(true)
    expect(git(fixture.root, ['submodule', 'status'])).not.toMatch(/^-/u)
  })

  it('leaves a recorded submodule empty when the policy is none', async () => {
    const scratch = scratchWorld()
    const fixture = withSubmodule(scratch)

    const createdWorktree = await new WorktreeService({ nestedRepositories: 'none' }).create({
      cwd: fixture.root, branch: 'bare', path: join(scratch, 'wt'),
    })

    expect(readdirSync(join(createdWorktree.path, 'child-sub'))).toEqual([])
  })

  it('gives an independently nested repository its own checkout and branch', async () => {
    const { scratch, root } = world('parent')
    const child = join(root, 'child-plain')
    repositoryAt(child, 'plain.txt', 'plain child\n')
    writeFileSync(join(root, '.gitignore'), 'child-plain/\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'ignore the nested repository'])

    const createdWorktree = await new WorktreeService({ nestedRepositories: 'all' }).create({
      cwd: root, branch: 'parent-1', path: join(scratch, 'wt'),
    })

    expect(createdWorktree.nested).toHaveLength(1)
    const [nested] = createdWorktree.nested
    expect(nested?.repositoryRoot).toBe(child)
    expect(nested?.path).toBe(join(createdWorktree.path, 'child-plain'))
    expect(nested?.branch).toMatch(/^main-\d{6}$/u)
    expect(readdirSync(join(createdWorktree.path, 'child-plain')).sort()).toEqual(['.git', 'plain.txt'])
    // Git reports checkout paths with forward slashes on every platform.
    expect(git(child, ['worktree', 'list']).replaceAll('\\', '/'))
      .toContain(join(createdWorktree.path, 'child-plain').replaceAll('\\', '/'))
    // The nested repository's own checkout is untouched by its new branch.
    expect(git(child, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main')
  })

  it('does not mirror a repository deeper than the configured scan depth', async () => {
    const { scratch, root } = world('parent')
    const child = join(root, 'group', 'child-plain')
    execFileSync('git', ['init', '-q', '-b', 'main', child], { env: { ...process.env, ...IDENTITY } })
    writeFileSync(join(child, 'plain.txt'), 'plain child\n')
    git(child, ['add', '-A'])
    git(child, ['commit', '-q', '-m', 'base'])
    writeFileSync(join(root, '.gitignore'), 'group/\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'ignore the nested repository'])

    const shallow = await new WorktreeService({ nestedRepositories: 'all', nestedScanDepth: 1 }).create({
      cwd: root, branch: 'shallow', path: join(scratch, 'wt-shallow'),
    })
    expect(shallow.nested).toEqual([])

    const deep = await new WorktreeService({ nestedRepositories: 'all', nestedScanDepth: 2 }).create({
      cwd: root, branch: 'deep', path: join(scratch, 'wt-deep'),
    })
    expect(deep.nested.map(entry => entry.path)).toEqual([join(deep.path, 'group', 'child-plain')])
  })

  it('removes the whole creation when a nested repository cannot take a branch', async () => {
    const { scratch, root } = world('parent')
    // A repository with no commit has no HEAD for a new branch to start from.
    execFileSync('git', ['init', '-q', '-b', 'main', join(root, 'empty-child')], {
      env: { ...process.env, ...IDENTITY },
    })
    writeFileSync(join(root, '.gitignore'), 'empty-child/\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'ignore the nested repository'])

    const target = join(scratch, 'wt')
    await expect(new WorktreeService({ nestedRepositories: 'all' })
      .create({ cwd: root, branch: 'rollback', path: target }))
      .rejects.toThrow(/empty-child/u)

    expect(existsSync(target)).toBe(false)
    expect((await new WorktreeService().list(root)).map(entry => entry.branch)).toEqual(['main'])
  })

  it('rejects a scan depth that is not a positive integer', () => {
    expect(() => new WorktreeService({ nestedScanDepth: 0 })).toThrow(/nestedScanDepth/u)
  })

  it('applies a replaced policy to the next creation', async () => {
    const { scratch, root } = world('parent')
    const child = join(root, 'child-plain')
    repositoryAt(child, 'plain.txt', 'plain child\n')
    writeFileSync(join(root, '.gitignore'), 'child-plain/\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'ignore the nested repository'])

    // The instance the live settings re-configure is the one every later
    // creation runs through, so what it holds now is the policy in force.
    const service = new WorktreeService({ nestedRepositories: 'none' })
    const before = await service.create({ cwd: root, branch: 'before', path: join(scratch, 'wt-before') })
    expect(before.nested).toEqual([])

    service.reconfigure({ nestedRepositories: 'all' })
    const after = await service.create({ cwd: root, branch: 'after', path: join(scratch, 'wt-after') })
    expect(after.nested.map(entry => entry.path)).toEqual([join(after.path, 'child-plain')])

    // A replaced policy is validated as strictly as a constructed one.
    expect(() => service.reconfigure({ agentsDirectory: '../escape' })).toThrow(/agentsDirectory/u)
  })
})

describe('removing a checkout that carries nested repositories', () => {
  it('removes the nested checkout and then the parent', async () => {
    const { scratch, root } = world('parent')
    const child = join(root, 'child-plain')
    repositoryAt(child, 'plain.txt', 'plain child\n')
    writeFileSync(join(root, '.gitignore'), 'child-plain/\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'ignore the nested repository'])

    const service = new WorktreeService({ nestedRepositories: 'all' })
    const createdWorktree = await service.create({ cwd: root, branch: 'parent-1', path: join(scratch, 'wt') })
    await service.remove({ cwd: root, path: createdWorktree.path })

    expect(existsSync(createdWorktree.path)).toBe(false)
    expect(git(child, ['worktree', 'list']).trim().split('\n')).toHaveLength(1)
  })

  it('refuses while the parent holds uncommitted work, leaving both checkouts in place', async () => {
    const { scratch, root } = world('parent')
    const child = join(root, 'child-plain')
    repositoryAt(child, 'plain.txt', 'plain child\n')
    writeFileSync(join(root, '.gitignore'), 'child-plain/\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'ignore the nested repository'])

    const service = new WorktreeService({ nestedRepositories: 'all' })
    const createdWorktree = await service.create({ cwd: root, branch: 'parent-1', path: join(scratch, 'wt') })
    writeFileSync(join(createdWorktree.path, 'tracked.txt'), 'edited\n')

    await expect(service.remove({ cwd: root, path: createdWorktree.path }))
      .rejects.toThrow(/uncommitted work/u)
    expect(existsSync(join(createdWorktree.path, 'tracked.txt'))).toBe(true)
    expect(existsSync(join(createdWorktree.path, 'child-plain', 'plain.txt'))).toBe(true)

    await service.remove({ cwd: root, path: createdWorktree.path, force: true })
    expect(existsSync(createdWorktree.path)).toBe(false)
  })

  it('removes a clean checkout that holds a materialized submodule', async () => {
    const scratch = scratchWorld()
    const fixture = withSubmodule(scratch)

    const service = new WorktreeService({ nestedRepositories: 'submodules' })
    const createdWorktree = await service.create({
      cwd: fixture.root, branch: 'sub', path: join(scratch, 'wt'),
    })
    expect(existsSync(join(createdWorktree.path, 'child-sub', 'lib.txt'))).toBe(true)

    await service.remove({ cwd: fixture.root, path: createdWorktree.path })

    expect(existsSync(createdWorktree.path)).toBe(false)
    // Git refuses such a worktree outright; the removal gets past that without
    // touching the submodule the caller's own checkout owns.
    expect(existsSync(join(fixture.submodule, 'lib.txt'))).toBe(true)
    expect(git(fixture.root, ['submodule', 'status'])).not.toMatch(/^-/u)
  })

  it('refuses to remove a submodule-bearing checkout that holds local work', async () => {
    const scratch = scratchWorld()
    const fixture = withSubmodule(scratch)

    const service = new WorktreeService({ nestedRepositories: 'submodules' })
    const createdWorktree = await service.create({
      cwd: fixture.root, branch: 'sub', path: join(scratch, 'wt'),
    })
    writeFileSync(join(createdWorktree.path, 'tracked.txt'), 'edited\n')

    await expect(service.remove({ cwd: fixture.root, path: createdWorktree.path }))
      .rejects.toThrow(/uncommitted work/u)
    expect(existsSync(createdWorktree.path)).toBe(true)
  })
})
