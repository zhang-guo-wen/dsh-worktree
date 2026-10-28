/**
 * The machine authorization scan behind the Git accounts page.
 *
 * Every case is hermetic: temporary home directories stand in for the operator's
 * `~/.git-credentials` and `~/.ssh`, and an injected command runner stands in for
 * the `gh` CLI and the Windows PowerShell helper, so this spec never reads a real
 * credential, never calls a provider, and never spawns a real helper. The one
 * production constant the cases pin is the Credential Manager script's wire
 * shape: anything the parser accepts must be what that script emits.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScanCommandResult, ScanCommandRunner, ScanEnvironment } from '../src/git-accounts/scan.ts'
import { scanAuthorizations } from '../src/git-accounts/scan.ts'
import {
  CREDENTIAL_MANAGER_SCRIPT,
  collectSshNotes,
  credentialManagerTargetUrl,
  decodeCredentialBlob,
  inferProvider,
  parseCredentialManagerOutput,
  parseGhToken,
  parseGitCredentials,
} from '../src/git-accounts/scan-parsers.ts'
import { SCAN_SOURCES } from '../src/git-accounts/types.ts'

const temporaryHomes: string[] = []

afterEach(() => {
  while (temporaryHomes.length > 0) {
    const directory = temporaryHomes.pop()
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  }
})

/** One temporary home directory, removed after the case. */
function temporaryHome(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-worktree-git-accounts-scan-'))
  temporaryHomes.push(directory)
  return directory
}

/** Write one file under the temporary home's `.ssh` directory. */
function writeSshFile(home: string, name: string, content = ''): void {
  const directory = join(home, '.ssh')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, name), content)
}

/** The base64 form of a UTF-16LE credential blob, the shape Windows stores. */
function utf16Blob(value: string): string {
  return Buffer.from(value, 'utf16le').toString('base64')
}

/** The base64 form of a UTF-8 credential blob, the shape some helpers store. */
function utf8Blob(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

/** One recorded helper command. */
interface RecordedCommand {
  readonly file: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}

/**
 * A command runner that records its calls and answers from a handler.
 * Without a handler it fails like a missing executable, so a case that only
 * cares about the file-backed sources never reaches a real helper.
 */
function commandRunner(
  answer: (file: string, args: readonly string[]) => ScanCommandResult | Promise<ScanCommandResult> = () => {
    throw Object.assign(new Error('command not available'), { code: 'ENOENT' })
  },
): { runner: ScanCommandRunner; calls: RecordedCommand[] } {
  const calls: RecordedCommand[] = []
  const runner: ScanCommandRunner = async (file, args, options) => {
    calls.push({ file, args: [...args], timeoutMs: options.timeoutMs })
    return await answer(file, args)
  }
  return { runner, calls }
}

/** A scan environment on Linux with an injected runner that finds no helpers. */
function scanEnvironment(homeDirectory: string, overrides: Partial<ScanEnvironment> = {}): ScanEnvironment {
  return {
    platform: 'linux',
    homeDirectory,
    environment: {},
    runCommand: commandRunner().runner,
    ...overrides,
  }
}

describe('parsing ~/.git-credentials lines', () => {
  it('reads one complete credential per line, with host, login, and token', () => {
    const candidates = parseGitCredentials([
      'https://octocat:ghp_github@github.com',
      'https://oauth2:glpat_gitlab@gitlab.arcuchi.com:8443/clone',
      // Plain http is accepted: the scan only reports what Git already stored
      // on this machine and never sends the credential anywhere itself.
      'http://gitee-user:gitee_token@gitee.com',
    ].join('\r\n'), 'git-credentials')

    expect(candidates).toEqual([
      { host: 'github.com', provider: 'github', token: 'ghp_github', login: 'octocat', source: 'git-credentials' },
      {
        host: 'gitlab.arcuchi.com:8443',
        provider: 'gitlab',
        token: 'glpat_gitlab',
        login: 'oauth2',
        source: 'git-credentials',
      },
      { host: 'gitee.com', provider: 'gitee', token: 'gitee_token', login: 'gitee-user', source: 'git-credentials' },
    ])
  })

  it('decodes percent-escaped user and password text', () => {
    const [candidate] = parseGitCredentials('https://user%40mail.example:p%40ss%3Aword@github.com', 'git-credentials')

    expect(candidate).toMatchObject({ login: 'user@mail.example', token: 'p@ss:word' })
  })

  it('skips lines that are not a complete http(s) credential', () => {
    const text = [
      '',
      'not a url',
      'https://github.com',
      'https://onlyuser@github.com',
      'https://:onlypassword@github.com',
      'ftp://user:token@github.com',
      'ssh://git@github.com/owner/repo',
    ].join('\n')

    expect(parseGitCredentials(text, 'git-credentials')).toEqual([])
  })

  it('trims surrounding whitespace and returns nothing for empty text', () => {
    expect(parseGitCredentials('   \n\t\n', 'git-credentials')).toEqual([])
    expect(parseGitCredentials('  https://user:token@github.com  \n', 'git-credentials')).toMatchObject([
      { host: 'github.com', token: 'token' },
    ])
  })

  it('keeps an unknown host without inventing a provider', () => {
    const [candidate] = parseGitCredentials('https://user:token@gitea.example.com', 'git-credentials')

    expect(candidate).toEqual({ host: 'gitea.example.com', token: 'token', login: 'user', source: 'git-credentials' })
  })
})

describe('parsing the Credential Manager script output', () => {
  it('accepts an array and keeps only Git credential targets', () => {
    const gitCredential = { target: 'git:https://github.com', userName: 'octocat', blobBase64: utf16Blob('ghp_one') }
    const stdout = JSON.stringify([
      gitCredential,
      { target: 'LegacyGeneric:target=git:https://gitlab.com', userName: '', blobBase64: '' },
      { target: 'LegacyGeneric:target=MicrosoftAccount:user=me', userName: 'me', blobBase64: utf16Blob('unrelated') },
      { target: 'Domain:interactive=DESKTOP\\me', userName: 'me', blobBase64: utf16Blob('unrelated') },
      { target: 'git-credential:https://gitee.com', userName: 'gitee-user', blobBase64: '' },
    ])

    expect(parseCredentialManagerOutput(stdout)).toEqual([
      gitCredential,
      { target: 'LegacyGeneric:target=git:https://gitlab.com', userName: '', blobBase64: '' },
      { target: 'git-credential:https://gitee.com', userName: 'gitee-user', blobBase64: '' },
    ])
  })

  it('accepts a single object and a leading byte-order mark', () => {
    const entry = { target: 'git:https://github.com', userName: 'octocat', blobBase64: '' }

    expect(parseCredentialManagerOutput(`\uFEFF${JSON.stringify(entry)}`)).toEqual([entry])
  })

  it('defaults a missing user name and blob to empty strings', () => {
    expect(parseCredentialManagerOutput(JSON.stringify({ target: 'git:https://github.com' }))).toEqual([
      { target: 'git:https://github.com', userName: '', blobBase64: '' },
    ])
  })

  it('returns nothing for empty, malformed, or targetless output', () => {
    expect(parseCredentialManagerOutput('')).toEqual([])
    expect(parseCredentialManagerOutput('[]')).toEqual([])
    expect(parseCredentialManagerOutput('{}')).toEqual([])
    expect(parseCredentialManagerOutput('not json')).toEqual([])
    expect(parseCredentialManagerOutput('42')).toEqual([])
    expect(parseCredentialManagerOutput(JSON.stringify([{ target: '' }, { userName: 'user' }, null, 'text']))).toEqual([])
  })
})

describe('decoding Credential Manager blobs', () => {
  it('decodes the UTF-16LE form Windows stores', () => {
    expect(decodeCredentialBlob(utf16Blob('ghp_utf16token'))).toBe('ghp_utf16token')
  })

  it('decodes the UTF-8 form a credential helper stores', () => {
    expect(decodeCredentialBlob(utf8Blob('ghp_utf8token'))).toBe('ghp_utf8token')
    expect(decodeCredentialBlob(utf8Blob('密码パスワード'))).toBe('密码パスワード')
  })

  it('drops trailing NUL padding and surrounding whitespace', () => {
    expect(decodeCredentialBlob(utf16Blob('  ghp_padded  \u0000\u0000'))).toBe('ghp_padded')
  })

  it('returns an empty string for empty or undecodable input', () => {
    expect(decodeCredentialBlob('')).toBe('')
    expect(decodeCredentialBlob('   ')).toBe('')
    expect(decodeCredentialBlob('!!!')).toBe('')
  })
})

describe('recovering the URL behind a Credential Manager target', () => {
  it('strips every Git credential prefix spelling', () => {
    expect(credentialManagerTargetUrl('git:https://github.com')).toBe('https://github.com/')
    expect(credentialManagerTargetUrl('LegacyGeneric:target=git:https://gitlab.com')).toBe('https://gitlab.com/')
    expect(credentialManagerTargetUrl('legacygeneric:target=GIT:https://gitee.com/some/path')).toBe(
      'https://gitee.com/some/path',
    )
    expect(credentialManagerTargetUrl('git-credential-manager:https://github.example.com:8443')).toBe(
      'https://github.example.com:8443/',
    )
  })

  it('rejects a target that is not an absolute http(s) URL behind a Git prefix', () => {
    expect(credentialManagerTargetUrl('git:')).toBeUndefined()
    expect(credentialManagerTargetUrl('git:not a url')).toBeUndefined()
    expect(credentialManagerTargetUrl('git:ftp://github.com')).toBeUndefined()
    expect(credentialManagerTargetUrl('some:thing')).toBeUndefined()
    expect(credentialManagerTargetUrl('')).toBeUndefined()
  })
})

describe('reading the gh token output', () => {
  it('returns the trimmed token', () => {
    expect(parseGhToken('ghp_abc123\n')).toBe('ghp_abc123')
    expect(parseGhToken('  ghp_abc123  \r\n')).toBe('ghp_abc123')
  })

  it('returns undefined when the command printed nothing', () => {
    expect(parseGhToken('')).toBeUndefined()
    expect(parseGhToken(' \n\t ')).toBeUndefined()
  })
})

describe('inferring a host family', () => {
  it('maps the three public hosts exactly', () => {
    expect(inferProvider('github.com')).toBe('github')
    expect(inferProvider('gitlab.com')).toBe('gitlab')
    expect(inferProvider('gitee.com')).toBe('gitee')
  })

  it('recognizes a self-hosted instance by its name', () => {
    expect(inferProvider('gitlab.arcuchi.com')).toBe('gitlab')
    expect(inferProvider('gitee.internal:8443')).toBe('gitee')
    expect(inferProvider('github.enterprise.example')).toBe('github')
    expect(inferProvider('GitHub.Enterprise.Example')).toBe('github')
  })

  it('leaves a host it cannot classify without a provider', () => {
    expect(inferProvider('bitbucket.org')).toBeUndefined()
    expect(inferProvider('code.example.com')).toBeUndefined()
    expect(inferProvider('')).toBeUndefined()
    expect(inferProvider('   ')).toBeUndefined()
  })
})

describe('reporting SSH material', () => {
  it('returns no note when the home has no .ssh directory', async () => {
    expect(await collectSshNotes(temporaryHome())).toEqual([])
  })

  it('names private keys but never their contents or public siblings', async () => {
    const home = temporaryHome()
    writeSshFile(home, 'id_ed25519', '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET\n')
    writeSshFile(home, 'id_rsa', 'PRIVATE KEY CONTENT')
    writeSshFile(home, 'id_ed25519.pub', 'ssh-ed25519 AAAAC3Nza')
    writeSshFile(home, 'known_hosts', 'github.com ssh-ed25519 AAAAC3Nza')

    const notes = await collectSshNotes(home)

    expect(notes).toEqual([{ code: 'ssh-keys-found', detail: 'id_ed25519, id_rsa' }])
    expect(JSON.stringify(notes)).not.toContain('PRIVATE KEY')
  })

  it('reads host aliases and key names from a config without keys on disk', async () => {
    const home = temporaryHome()
    writeSshFile(home, 'config', [
      '# a comment',
      'Host work',
      '  HostName gitlab.arcuchi.com',
      '  IdentityFile ~/.ssh/id_work',
      '',
      'Host *',
      '  ServerAliveInterval 30',
    ].join('\n'))

    expect(await collectSshNotes(home)).toEqual([
      { code: 'ssh-keys-found', detail: 'work, gitlab.arcuchi.com, id_work' },
    ])
  })

  it('caps the note at five findings', async () => {
    const home = temporaryHome()
    for (const name of ['id_a', 'id_b', 'id_c', 'id_d', 'id_e', 'id_f']) writeSshFile(home, name)

    expect(await collectSshNotes(home)).toEqual([
      { code: 'ssh-keys-found', detail: 'id_a, id_b, id_c, id_d, id_e' },
    ])
  })

  it('treats a .ssh that is not a directory as no material', async () => {
    const home = temporaryHome()
    writeFileSync(join(home, '.ssh'), 'not a directory')

    expect(await collectSshNotes(home)).toEqual([])
  })
})

describe('the Credential Manager script', () => {
  it('enumerates generic credentials and prints compressed JSON, standing in for git targets only', () => {
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain('CredEnumerateW')
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain('CredFree')
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain('advapi32.dll')
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain('StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)')
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain('Marshal.Copy')
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain('Convert.ToBase64String')
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain('ConvertTo-Json -InputObject @($entries) -Compress')
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain("$ErrorActionPreference = 'Stop'")
    expect(CREDENTIAL_MANAGER_SCRIPT).toContain("[Console]::Out.Write('[]')")
  })
})

describe('scanning the machine', () => {
  it('reports all five sources in shared order and spawns only the helper it must', async () => {
    const { runner, calls } = commandRunner()

    const result = await scanAuthorizations(scanEnvironment(temporaryHome(), { runCommand: runner }))

    expect(result.candidates).toEqual([])
    expect(result.sources.map(source => source.id)).toEqual([...SCAN_SOURCES])
    expect(result.sources).toEqual([
      { id: 'credential-manager', available: false, supported: false },
      { id: 'git-credentials', available: false, supported: true },
      { id: 'gh-cli', available: false, supported: true },
      { id: 'environment', available: false, supported: true },
      { id: 'ssh', available: false, supported: true },
    ])
    expect(result.notes).toEqual([{ code: 'platform-unsupported', detail: 'windows' }])
    // Only gh is attempted off Windows; the Credential Manager script is not spawned.
    expect(calls).toEqual([{ file: 'gh', args: ['auth', 'token'], timeoutMs: 10_000 }])
  })

  it('reads the token environment variables in host order', async () => {
    const result = await scanAuthorizations(scanEnvironment(temporaryHome(), {
      environment: {
        GH_TOKEN: 'ghp_env_github',
        GITLAB_PRIVATE_TOKEN: 'glpat_env_gitlab',
        GITEE_ACCESS_TOKEN: 'gitee_env_token',
      },
    }))

    expect(result.candidates).toEqual([
      { host: 'github.com', provider: 'github', token: 'ghp_env_github', source: 'environment' },
      { host: 'gitlab.com', provider: 'gitlab', token: 'glpat_env_gitlab', source: 'environment' },
      { host: 'gitee.com', provider: 'gitee', token: 'gitee_env_token', source: 'environment' },
    ])
    expect(result.sources.find(source => source.id === 'environment')).toEqual({
      id: 'environment',
      available: true,
      supported: true,
    })
  })

  it('skips blank environment tokens and deduplicates one token under both names', async () => {
    const blank = await scanAuthorizations(scanEnvironment(temporaryHome(), {
      environment: { GH_TOKEN: '   ', GITHUB_TOKEN: '' },
    }))
    expect(blank.candidates).toEqual([])
    expect(blank.sources.find(source => source.id === 'environment')).toEqual({
      id: 'environment',
      available: false,
      supported: true,
    })

    const duplicate = await scanAuthorizations(scanEnvironment(temporaryHome(), {
      environment: { GH_TOKEN: 'ghp_same', GITHUB_TOKEN: 'ghp_same' },
    }))
    expect(duplicate.candidates).toEqual([
      { host: 'github.com', provider: 'github', token: 'ghp_same', source: 'environment' },
    ])
  })

  it('reads ~/.git-credentials and deduplicates a token the environment already provided', async () => {
    const home = temporaryHome()
    writeFileSync(join(home, '.git-credentials'), [
      'https://octocat:ghp_same@github.com',
      'https://oauth2:glpat_store@gitlab.com',
    ].join('\n'))

    const result = await scanAuthorizations(scanEnvironment(home, {
      environment: { GH_TOKEN: 'ghp_same' },
    }))

    expect(result.candidates).toEqual([
      { host: 'github.com', provider: 'github', token: 'ghp_same', source: 'environment' },
      {
        host: 'gitlab.com',
        provider: 'gitlab',
        token: 'glpat_store',
        login: 'oauth2',
        source: 'git-credentials',
      },
    ])
    expect(result.sources.find(source => source.id === 'git-credentials')).toEqual({
      id: 'git-credentials',
      available: true,
      supported: true,
    })
    const keys = result.candidates.map(candidate => `${candidate.provider ?? '?'}|${candidate.host}|${candidate.token}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('reports an unreadable ~/.git-credentials as present but empty instead of failing the scan', async () => {
    const home = temporaryHome()
    writeFileSync(join(home, '.git-credentials'), 'this is not a credential\n')

    const result = await scanAuthorizations(scanEnvironment(home))

    expect(result.candidates).toEqual([])
    expect(result.sources.find(source => source.id === 'git-credentials')).toEqual({
      id: 'git-credentials',
      available: true,
      supported: true,
    })
  })

  it('adopts the gh CLI token when the command succeeds', async () => {
    const { runner, calls } = commandRunner(file => {
      if (file === 'gh') return { stdout: 'ghp_from_gh\n' }
      throw new Error(`unexpected command ${file}`)
    })

    const result = await scanAuthorizations(scanEnvironment(temporaryHome(), { runCommand: runner }))

    expect(result.candidates).toEqual([
      { host: 'github.com', provider: 'github', token: 'ghp_from_gh', source: 'gh-cli' },
    ])
    expect(result.sources.find(source => source.id === 'gh-cli')).toEqual({
      id: 'gh-cli',
      available: true,
      supported: true,
    })
    expect(calls).toEqual([{ file: 'gh', args: ['auth', 'token'], timeoutMs: 10_000 }])
  })

  it('leaves the gh source unavailable when the command prints nothing or fails', async () => {
    const empty = await scanAuthorizations(scanEnvironment(temporaryHome(), {
      runCommand: commandRunner(() => ({ stdout: '\n' })).runner,
    }))
    expect(empty.candidates).toEqual([])
    expect(empty.sources.find(source => source.id === 'gh-cli')).toEqual({
      id: 'gh-cli',
      available: false,
      supported: true,
    })

    const failing = await scanAuthorizations(scanEnvironment(temporaryHome(), {
      runCommand: commandRunner(() => {
        throw new Error('gh is not logged in')
      }).runner,
    }))
    expect(failing.candidates).toEqual([])
    expect(failing.sources.find(source => source.id === 'gh-cli')).toEqual({
      id: 'gh-cli',
      available: false,
      supported: true,
    })
  })

  it('reads the Windows Credential Manager through powershell', async () => {
    const githubBlob = utf16Blob('ghp_cm_token')
    const gitlabBlob = utf8Blob('glpat_cm_token')
    const { runner, calls } = commandRunner(file => {
      if (file === 'gh') return { stdout: 'ghp_gh_token\n' }
      if (file === 'powershell.exe') {
        return {
          stdout: JSON.stringify([
            { target: 'git:https://github.com', userName: 'DOMAIN\\octocat', blobBase64: githubBlob },
            {
              target: 'LegacyGeneric:target=git:https://gitlab.arcuchi.com',
              userName: '',
              blobBase64: gitlabBlob,
            },
          ]),
        }
      }
      throw new Error(`unexpected command ${file}`)
    })

    const result = await scanAuthorizations(scanEnvironment(temporaryHome(), { platform: 'win32', runCommand: runner }))

    expect(result.candidates).toEqual([
      { host: 'github.com', provider: 'github', token: 'ghp_gh_token', source: 'gh-cli' },
      {
        host: 'github.com',
        provider: 'github',
        token: 'ghp_cm_token',
        login: 'octocat',
        source: 'credential-manager',
      },
      {
        host: 'gitlab.arcuchi.com',
        provider: 'gitlab',
        token: 'glpat_cm_token',
        source: 'credential-manager',
      },
    ])
    expect(result.sources.find(source => source.id === 'credential-manager')).toEqual({
      id: 'credential-manager',
      available: true,
      supported: true,
    })
    expect(result.notes).toEqual([])
    expect(calls.map(call => call.file)).toEqual(['gh', 'powershell.exe'])
    expect(calls[1]?.timeoutMs).toBe(20_000)
    expect(calls[1]?.args.slice(0, 6)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
    ])
    expect(calls[1]?.args[6]).toBe(CREDENTIAL_MANAGER_SCRIPT)
  })

  it('skips Credential Manager entries with no password or no URL', async () => {
    const { runner } = commandRunner(file => {
      if (file === 'powershell.exe') {
        return {
          stdout: JSON.stringify([
            { target: 'git:https://github.com', userName: 'user', blobBase64: '' },
            { target: 'git:not-a-url', userName: 'user', blobBase64: utf8Blob('token') },
            {
              target: 'LegacyGeneric:target=MicrosoftAccount:user=me',
              userName: 'user',
              blobBase64: utf8Blob('token'),
            },
            { target: 'git:https://gitea.example.com', userName: 'user', blobBase64: utf8Blob('token') },
          ]),
        }
      }
      throw new Error(`unexpected command ${file}`)
    })

    const result = await scanAuthorizations(scanEnvironment(temporaryHome(), { platform: 'win32', runCommand: runner }))

    expect(result.candidates).toEqual([
      { host: 'gitea.example.com', token: 'token', login: 'user', source: 'credential-manager' },
    ])
  })

  it('keeps the Credential Manager available when the store holds no credentials', async () => {
    const { runner } = commandRunner(file => {
      if (file === 'powershell.exe') return { stdout: '[]' }
      throw new Error(`unexpected command ${file}`)
    })

    const result = await scanAuthorizations(scanEnvironment(temporaryHome(), { platform: 'win32', runCommand: runner }))

    expect(result.candidates).toEqual([])
    expect(result.sources.find(source => source.id === 'credential-manager')).toEqual({
      id: 'credential-manager',
      available: true,
      supported: true,
    })
    expect(result.notes).toEqual([])
  })

  it('notes a missing powershell and marks the Credential Manager unavailable but supported', async () => {
    const result = await scanAuthorizations(scanEnvironment(temporaryHome(), {
      platform: 'win32',
      runCommand: commandRunner(() => {
        throw Object.assign(new Error('command not available'), { code: 'ENOENT' })
      }).runner,
    }))

    expect(result.sources.find(source => source.id === 'credential-manager')).toEqual({
      id: 'credential-manager',
      available: false,
      supported: true,
    })
    expect(result.notes).toEqual([{ code: 'tool-missing', detail: 'powershell' }])
  })

  it('turns an SSH config key/host pair into a candidate and keeps the note', async () => {
    const home = temporaryHome()
    writeSshFile(home, 'id_ed25519', 'PRIVATE KEY CONTENT')
    writeSshFile(home, 'config', [
      'Host gitlab-work',
      '  HostName gitlab.arcuchi.com',
      '  IdentityFile ~/.ssh/id_ed25519',
    ].join('\n'))

    const result = await scanAuthorizations(scanEnvironment(home))

    expect(result.notes).toEqual([
      { code: 'platform-unsupported', detail: 'windows' },
      { code: 'ssh-keys-found', detail: 'id_ed25519, gitlab-work, gitlab.arcuchi.com' },
    ])
    // A config pair becomes an automatic SSH candidate; the key's contents are
    // never read by the scan.
    expect(result.candidates).toEqual([{
      host: 'gitlab.arcuchi.com',
      provider: 'gitlab',
      auth: 'ssh',
      keyPath: join(home, '.ssh', 'id_ed25519'),
      source: 'ssh',
    }])
    expect(result.sources.find(source => source.id === 'ssh')).toEqual({ id: 'ssh', available: true, supported: true })
  })

  it('never puts a token in a note or a source status', async () => {
    const home = temporaryHome()
    writeFileSync(join(home, '.git-credentials'), 'https://octocat:ghp_file_secret@github.com\n')
    writeSshFile(home, 'id_ed25519', 'PRIVATE KEY CONTENT')
    const { runner } = commandRunner(file => {
      if (file === 'gh') return { stdout: 'ghp_gh_secret\n' }
      if (file === 'powershell.exe') {
        return {
          stdout: JSON.stringify([
            { target: 'git:https://github.com', userName: 'octocat', blobBase64: utf16Blob('ghp_cm_secret') },
          ]),
        }
      }
      throw new Error(`unexpected command ${file}`)
    })

    const result = await scanAuthorizations(scanEnvironment(home, {
      platform: 'win32',
      environment: { GH_TOKEN: 'ghp_env_secret' },
      runCommand: runner,
    }))

    const withoutCandidates = JSON.stringify({ notes: result.notes, sources: result.sources })
    for (const token of ['ghp_env_secret', 'ghp_file_secret', 'ghp_gh_secret', 'ghp_cm_secret']) {
      expect(withoutCandidates).not.toContain(token)
    }
    expect(result.notes).toEqual([{ code: 'ssh-keys-found', detail: 'id_ed25519' }])
  })
})
