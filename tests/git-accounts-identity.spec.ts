/**
 * The global Git-identity contract.
 *
 * Every case runs Git against a scratch configuration file through
 * `GIT_CONFIG_GLOBAL`/`HOME`, so no case reads or writes the operator's own
 * `~/.gitconfig`. What is under test is the read/write contract the page sees:
 * unset reads as empty, a write is validated before either key changes, and a
 * cleared field removes its key.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GitIdentityError, readGitIdentity, validateEmail, validateName, writeGitIdentity,
} from '../src/git-accounts/identity.ts'

/** Scratch directories the current case created, removed on teardown. */
const created: string[] = []

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

/**
 * A scratch working directory plus the environment that keeps Git inside it.
 * @returns the directory the Git process runs in and its isolated environment.
 */
function scratch(): { readonly cwd: string; readonly environment: Record<string, string> } {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-worktree-identity-'))
  created.push(cwd)
  return {
    cwd,
    environment: {
      GIT_CONFIG_GLOBAL: join(cwd, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: cwd,
      USERPROFILE: cwd,
    },
  }
}

describe('the global Git identity', () => {
  it('reads an unset identity as empty instead of failing', async () => {
    const { cwd, environment } = scratch()
    await expect(readGitIdentity(cwd, environment)).resolves.toEqual({ name: '', email: '', available: true })
  })

  it('writes both keys and reads them back', async () => {
    const { cwd, environment } = scratch()
    const written = await writeGitIdentity(cwd, { name: 'Ada Lovelace', email: 'ada@example.com' }, environment)
    expect(written).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com', available: true })
    await expect(readGitIdentity(cwd, environment)).resolves.toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      available: true,
    })
  })

  it('clears a key whose field is submitted empty', async () => {
    const { cwd, environment } = scratch()
    await writeGitIdentity(cwd, { name: 'Ada Lovelace', email: 'ada@example.com' }, environment)
    const cleared = await writeGitIdentity(cwd, { name: '', email: 'ada@example.com' }, environment)
    expect(cleared.name).toBe('')
    const both = await writeGitIdentity(cwd, { name: '', email: '' }, environment)
    expect(both).toEqual({ name: '', email: '', available: true })
  })

  it('rejects an invalid email before either key is written', async () => {
    const { cwd, environment } = scratch()
    await expect(writeGitIdentity(cwd, { name: 'Ada Lovelace', email: 'not-an-email' }, environment))
      .rejects.toBeInstanceOf(GitIdentityError)
    // The valid half must not have landed: the pair is validated as a pair.
    await expect(readGitIdentity(cwd, environment)).resolves.toMatchObject({ name: '', email: '' })
  })

  it('rejects a name with a control character', () => {
    expect(() => validateName('Ada\u0007Lovelace')).toThrow(GitIdentityError)
    expect(validateName('  Ada  ')).toBe('Ada')
  })

  it('rejects an over-long name and over-long email', () => {
    expect(() => validateName('a'.repeat(201))).toThrow(GitIdentityError)
    expect(() => validateEmail(`${'a'.repeat(320)}@example.com`)).toThrow(GitIdentityError)
    expect(validateEmail(' ada@example.com ')).toBe('ada@example.com')
  })
})
