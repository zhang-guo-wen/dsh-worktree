import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { liveWorktrees, parseBranchList, parseWorktreeList } from '../src/porcelain.ts'
import { repositoryRootFromGitFile } from '../src/repository.ts'
import {
  agentsWorktreePath,
  assertAbsolutePath,
  assertAgentsDirectory,
  assertBranchName,
  defaultBranchName,
  siblingWorktreePath,
} from '../src/validate.ts'

describe('porcelain parsing', () => {
  it('reads one branch name per line and drops blank records', () => {
    expect(parseBranchList('dev\nfeature/x\n\n')).toEqual(['dev', 'feature/x'])
    expect(parseBranchList('')).toEqual([])
  })

  it('parses newline-separated records with branches and detached HEADs', () => {
    expect(parseWorktreeList([
      'worktree C:/repo/main',
      'HEAD aaaa1111',
      'branch refs/heads/main',
      '',
      'worktree C:/repo/agent',
      'HEAD bbbb2222',
      'detached',
      '',
    ].join('\n'))).toEqual([
      { path: 'C:/repo/main', branch: 'main', head: 'aaaa1111', locked: false, prunable: false },
      { path: 'C:/repo/agent', branch: 'HEAD', head: 'bbbb2222', locked: false, prunable: false },
    ])
  })

  it('parses NUL-separated records produced by -z', () => {
    expect(parseWorktreeList([
      'worktree C:/repo/main\nHEAD aaaa1111\nbranch refs/heads/main\n',
      'worktree C:/repo/wt\nHEAD bbbb2222\nbranch refs/heads/feature/x\n',
      '',
    ].join('\0'))).toEqual([
      { path: 'C:/repo/main', branch: 'main', head: 'aaaa1111', locked: false, prunable: false },
      { path: 'C:/repo/wt', branch: 'feature/x', head: 'bbbb2222', locked: false, prunable: false },
    ])
  })

  it('keeps spaces in a checkout path intact', () => {
    const parsed = parseWorktreeList('worktree C:/repo/agent checkout\nHEAD cccc\nbranch refs/heads/agent\n')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.path).toBe('C:/repo/agent checkout')
  })

  it('records lock and prune metadata rather than dropping the record', () => {
    const parsed = parseWorktreeList([
      'worktree C:/repo/locked',
      'HEAD aaaa',
      'branch refs/heads/locked',
      'locked in use',
      '',
      'worktree C:/repo/gone',
      'HEAD bbbb',
      'branch refs/heads/gone',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n'))
    expect(parsed[0]).toMatchObject({ path: 'C:/repo/locked', locked: true, prunable: false })
    expect(parsed[1]).toMatchObject({ path: 'C:/repo/gone', locked: false, prunable: true })
  })

  it('separates live checkouts from prunable metadata', () => {
    const parsed = parseWorktreeList([
      'worktree C:/repo/main',
      'HEAD aaaa',
      'branch refs/heads/main',
      '',
      'worktree C:/repo/gone',
      'HEAD bbbb',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n'))
    expect(parsed).toHaveLength(2)
    expect(liveWorktrees(parsed).map(record => record.path)).toEqual(['C:/repo/main'])
  })

  it('ignores unknown keys so a future Git field cannot fail the parse', () => {
    const parsed = parseWorktreeList([
      'worktree C:/repo/main',
      'HEAD aaaa',
      'branch refs/heads/main',
      'bare',
      'future-field value',
      '',
    ].join('\n'))
    expect(parsed).toEqual([
      { path: 'C:/repo/main', branch: 'main', head: 'aaaa', locked: false, prunable: false },
    ])
  })

  it('returns nothing for empty output', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
})

describe('repository root recovery', () => {
  it('recovers the main repository from a linked worktree gitdir', () => {
    // Git writes the gitdir with forward slashes on every platform; the
    // recovered root keeps the spelling Git recorded.
    expect(repositoryRootFromGitFile('gitdir: C:/repo/.git/worktrees/agent'))
      .toBe('C:/repo')
  })

  it('recovers a POSIX repository from a linked worktree gitdir', () => {
    expect(repositoryRootFromGitFile('gitdir: /home/u/repo/.git/worktrees/agent'))
      .toBe('/home/u/repo')
  })

  it('does not treat a submodule gitdir as a linked worktree', () => {
    expect(repositoryRootFromGitFile('gitdir: ../.git/modules/sub')).toBeUndefined()
  })

  it('returns nothing when the file carries no gitdir line', () => {
    expect(repositoryRootFromGitFile('not a git file')).toBeUndefined()
  })
})

describe('branch and path validation', () => {
  it('accepts ordinary branch names including nested ones', () => {
    for (const branch of ['main', 'feature/x', 'dsh/wt-2026', 'release-1.2']) {
      expect(() => assertBranchName(branch)).not.toThrow()
    }
  })

  it('rejects names git would refuse or that could be read as an option', () => {
    for (const branch of ['', 'has space', '-flag', 'a..b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'x.lock', '@']) {
      expect(() => assertBranchName(branch), branch).toThrow()
    }
  })

  it('requires an absolute path without parent segments', () => {
    expect(() => assertAbsolutePath('/work/tree', 'path')).not.toThrow()
    expect(() => assertAbsolutePath('work/tree', 'path')).toThrow(/must be an absolute path/)
    expect(() => assertAbsolutePath('/work/../escape', 'path')).toThrow(/"\.\."/)
  })

  it('derives both checkout layouts and validates the agent directory', () => {
    // `node:path` spells separators for the host platform, so the expectation
    // is built with the same module rather than hard-coding a separator.
    expect(siblingWorktreePath(join('/', 'home', 'u', 'repo'), 'feature/x'))
      .toBe(join('/', 'home', 'u', 'repo-wt-feature-x'))
    expect(agentsWorktreePath(join('/', 'home', 'u', 'repo'), 'feature/x', '.agents'))
      .toBe(join('/', 'home', 'u', 'repo', '.agents', 'feature-x'))

    for (const directory of ['', '/absolute', 'C:\\absolute', '..', 'a/../b']) {
      expect(() => assertAgentsDirectory(directory), directory).toThrow(/agentsDirectory/)
    }
    expect(() => assertAgentsDirectory('.agents')).not.toThrow()
    expect(() => assertAgentsDirectory('nested/agents')).not.toThrow()
  })

  it('generates a branch name git accepts, naming a recorded base', () => {
    const branch = defaultBranchName()
    expect(branch).toMatch(/^worktree-\d{6}$/)
    expect(() => assertBranchName(branch)).not.toThrow()

    // The base is the one fact about a worktree that nothing else records, so
    // the name carries it; a nested branch name flattens into one segment.
    const named = defaultBranchName('feature/x')
    expect(named).toMatch(/^feature-x-\d{6}$/)
    expect(() => assertBranchName(named)).not.toThrow()

    // The random suffix is what keeps two worktrees of one base apart.
    const draws = new Set(Array.from({ length: 20 }, () => defaultBranchName('feature/x')))
    expect(draws.size).toBeGreaterThan(1)
  })
})
