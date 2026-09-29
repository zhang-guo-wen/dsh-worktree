import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runGit } from '../src/git.ts'

describe('Git process errors', () => {
  it('reports a missing Git executable with a useful action and code', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-worktree-git-'))
    vi.stubEnv('PATH', join(cwd, 'missing'))
    try {
      await expect(runGit(cwd, ['--version'])).rejects.toMatchObject({
        code: 'git_not_found',
        message: expect.stringContaining('Install Git'),
      })
    } finally {
      vi.unstubAllEnvs()
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
