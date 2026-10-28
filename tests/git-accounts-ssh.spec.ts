/**
 * SSH-key verification and discovery, without a network connection.
 *
 * These specs cover the pure parts of the SSH edge: the banner each host family
 * prints, the path expansion and key-file reading behind the add dialog's key
 * picker, and the `~/.ssh/config` pairing a scan turns into automatic
 * candidates. The one probe path exercised here is the one that ends before
 * spawning `ssh` — a missing key file is refused locally, so no case reaches the
 * network, and no case reads a private key's contents.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SshVerificationError,
  collectSshKeyCandidates,
  expandKeyPath,
  listSshKeys,
  parseSshBanner,
  resolveExistingKey,
  sshProbeEndpoints,
  verifySshKey,
} from '../src/git-accounts/ssh.ts'

/** Scratch directories the current case created, removed on teardown. */
const created: string[] = []

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

/**
 * Create one scratch home directory.
 * @returns its absolute path.
 */
function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-worktree-ssh-'))
  created.push(home)
  return home
}

/**
 * Write one file under `<home>/.ssh`.
 * @param home - the scratch home.
 * @param name - the file name.
 * @param content - the file's text.
 */
function writeSshFile(home: string, name: string, content: string): void {
  mkdirSync(join(home, '.ssh'), { recursive: true })
  writeFileSync(join(home, '.ssh', name), content)
}

describe('reading a host SSH banner', () => {
  it('reads GitHub, GitLab, and Gitee success banners and the login each names', () => {
    expect(parseSshBanner("Hi octocat! You've successfully authenticated, but GitHub does not provide shell access."))
      .toEqual({ authenticated: true, login: 'octocat', provider: 'github' })
    expect(parseSshBanner('Welcome to GitLab, @octo!'))
      .toEqual({ authenticated: true, login: 'octo', provider: 'gitlab' })
    expect(parseSshBanner("Hi octo! You've successfully authenticated, but GITEE.COM does not provide shell access."))
      .toEqual({ authenticated: true, login: 'octo', provider: 'gitee' })
    expect(parseSshBanner('Welcome to Gitee.com, octo!'))
      .toEqual({ authenticated: true, login: 'octo', provider: 'gitee' })
  })

  it('reports a success without an attributable login, and a refusal as unauthenticated', () => {
    expect(parseSshBanner('You have successfully authenticated.')).toEqual({ authenticated: true })
    expect(parseSshBanner('git@github.com: Permission denied (publickey).'))
      .toEqual({ authenticated: false })
  })
})

describe('path expansion and key files', () => {
  it('expands a leading tilde and resolves relative paths against the home directory', () => {
    expect(expandKeyPath('~/.ssh/id_ed25519', 'C:\\Users\\me')).toBe('C:\\Users\\me\\.ssh\\id_ed25519')
    expect(expandKeyPath('id_ed25519', 'C:\\Users\\me')).toBe('C:\\Users\\me\\id_ed25519')
  })

  it('refuses a key path that is not a file before any probe starts', async () => {
    const home = temporaryHome()
    await expect(resolveExistingKey(join(home, '.ssh', 'missing'), home)).rejects.toBeInstanceOf(SshVerificationError)
    await expect(verifySshKey({ provider: 'github', host: 'github.com', keyPath: join(home, '.ssh', 'missing') }))
      .rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('lists existing private keys from ~/.ssh and config IdentityFile entries', async () => {
    const home = temporaryHome()
    writeSshFile(home, 'id_ed25519', 'PRIVATE KEY CONTENT')
    writeSshFile(home, 'id_ed25519.pub', 'ssh-ed25519 AAAA fixture')
    writeSshFile(home, 'config', 'Host work\n  HostName github.com\n  IdentityFile ~/.ssh/id_work\n')
    writeFileSync(join(home, '.ssh', 'id_work'), 'PRIVATE KEY CONTENT')

    const keys = await listSshKeys(home)
    expect(keys.map(key => key.name)).toEqual(['id_ed25519', 'id_work'])
    expect(keys.every(key => key.path.startsWith(home))).toBe(true)
  })

  it('turns only config pairs for known hosts into SSH candidates', async () => {
    const home = temporaryHome()
    writeSshFile(home, 'config', [
      'Host gitlab-work',
      '  HostName gitlab.arcuchi.com',
      '  IdentityFile ~/.ssh/id_ed25519',
      '',
      'Host *',
      '  IdentityFile ~/.ssh/id_rsa',
      '',
      'Host random',
      '  HostName example.com',
      '  IdentityFile ~/.ssh/id_unknown',
    ].join('\n'))

    expect(await collectSshKeyCandidates(home)).toEqual([
      { keyPath: join(home, '.ssh', 'id_ed25519'), host: 'gitlab.arcuchi.com', provider: 'gitlab' },
    ])
  })

  it('answers no candidates when ~/.ssh is absent', async () => {
    const home = temporaryHome()
    expect(await collectSshKeyCandidates(home)).toEqual([])
    expect(await listSshKeys(home)).toEqual([])
  })
})

describe('choosing SSH endpoints', () => {
  it('tries the canonical github/gitlab host on 22 and then on 443', () => {
    expect(sshProbeEndpoints('github', 'github.com')).toEqual([
      { hostname: 'github.com', port: undefined },
      { hostname: 'ssh.github.com', port: '443' },
    ])
    expect(sshProbeEndpoints('gitlab', 'gitlab.com')).toEqual([
      { hostname: 'gitlab.com', port: undefined },
      { hostname: 'altssh.gitlab.com', port: '443' },
    ])
  })

  it('never falls back for a custom port, a self-hosted host, or Gitee', () => {
    expect(sshProbeEndpoints('github', 'github.com:2222')).toEqual([{ hostname: 'github.com', port: '2222' }])
    expect(sshProbeEndpoints('gitlab', 'gitlab.arcuchi.com')).toEqual([{ hostname: 'gitlab.arcuchi.com', port: undefined }])
    expect(sshProbeEndpoints('gitee', 'gitee.com')).toEqual([{ hostname: 'gitee.com', port: undefined }])
  })
})
