/**
 * Host-side discovery of the Git authorizations this machine already stores.
 *
 * A scan reads five sources in a fixed order — environment variables,
 * `~/.git-credentials`, the `gh` CLI, on Windows the Credential Manager, and the
 * SSH configuration's key/host pairs — and never verifies or stores anything
 * itself. Verification belongs to the account service, which probes each
 * candidate's host and decides whether it becomes an account; this module only
 * reports what it found, where it found it, and what it deliberately did not
 * import.
 *
 * Two rules keep the result safe to hand upward:
 * - a token appears only in {@link RawScanCandidate.token}, never in a note or
 *   an error message,
 * - a private key appears only as a path in {@link RawScanCandidate.keyPath};
 *   its contents are never read here, and
 * - every source the scan could not read is reported as unavailable instead of
 *   being silently skipped.
 * @module @guowenzhang/dsh-worktree/git-accounts/scan
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CREDENTIAL_MANAGER_SCRIPT,
  collectSshNotes,
  credentialManagerTargetUrl,
  decodeCredentialBlob,
  inferProvider,
  parseCredentialManagerOutput,
  parseGhToken,
  parseGitCredentials,
} from './scan-parsers.ts'
import { collectSshKeyCandidates } from './ssh.ts'
import { SCAN_SOURCES, type GitAuthMethod, type GitProvider, type ScanNote, type ScanSourceId, type ScanSourceStatus } from './types.ts'

/** One credential the scan found, before the account service verifies it. */
export interface RawScanCandidate {
  /** Host the credential names, e.g. `github.com` or `gitlab.arcuchi.com:8443`. */
  readonly host: string
  /** Host family when it can be inferred from the host; absent when it cannot. */
  readonly provider?: GitProvider
  /** How the candidate authenticates; absent means a token (the original sources' only kind). */
  readonly auth?: GitAuthMethod
  /** The token to verify; the only field that may carry a secret value. Absent for an SSH candidate. */
  readonly token?: string
  /** Private key path for an SSH candidate; its contents are never read. */
  readonly keyPath?: string
  /** Login the source stored, when it stored one. */
  readonly login?: string
  /** Where the credential was found. */
  readonly source: ScanSourceId
}

/** Everything one scan saw: candidates, source availability, and caveats. */
export interface RawScanResult {
  /** Candidates in source order, then discovery order, deduplicated. */
  readonly candidates: readonly RawScanCandidate[]
  /** All five sources in {@link SCAN_SOURCES} order. */
  readonly sources: readonly ScanSourceStatus[]
  /** Caveats worth reporting; never contains a token. */
  readonly notes: readonly ScanNote[]
}

/** How long one child-process read may take, in milliseconds. */
export interface ScanCommandOptions {
  /** Milliseconds before the child is killed and the read fails. */
  readonly timeoutMs: number
}

/** What a child-process read produced. */
export interface ScanCommandResult {
  /** The command's stdout, undecoded beyond Node's UTF-8 string decoding. */
  readonly stdout: string
}

/**
 * Run one scan helper command and return its stdout.
 *
 * The production implementation spawns the command without a shell; tests
 * inject their own runner so the gh and powershell branches are covered without
 * touching the machine.
 */
export type ScanCommandRunner = (
  file: string,
  args: readonly string[],
  options: ScanCommandOptions,
) => Promise<ScanCommandResult>

/** What one scan is allowed to read. */
export interface ScanEnvironment {
  /** Host platform, which decides whether the Credential Manager applies. */
  readonly platform: NodeJS.Platform
  /** The operator's home directory, which holds `.git-credentials` and `.ssh`. */
  readonly homeDirectory: string
  /** The environment to read tokens from; a subset of `process.env` is enough. */
  readonly environment: Readonly<Record<string, string | undefined>>
  /**
   * Command runner override for the gh and powershell reads.
   *
   * Production omits it and the scan spawns the commands directly. The spec
   * injects a fake so both branch families are covered hermetically and a test
   * run never touches the operator's real gh login or credential store.
   */
  readonly runCommand?: ScanCommandRunner
}

/** One environment variable family that holds a host token. */
interface EnvironmentTokenSource {
  /** Variables to read, in priority order; a set one becomes a candidate. */
  readonly names: readonly string[]
  /** Host the variable's token belongs to. */
  readonly host: string
  /** Host family the host belongs to. */
  readonly provider: GitProvider
}

/** Environment variables that carry a token for a known host. */
const ENVIRONMENT_TOKEN_SOURCES: readonly EnvironmentTokenSource[] = [
  { names: ['GH_TOKEN', 'GITHUB_TOKEN'], host: 'github.com', provider: 'github' },
  { names: ['GITLAB_TOKEN', 'GITLAB_PRIVATE_TOKEN'], host: 'gitlab.com', provider: 'gitlab' },
  { names: ['GITEE_TOKEN', 'GITEE_ACCESS_TOKEN'], host: 'gitee.com', provider: 'gitee' },
]

/** `gh auth token` should answer immediately; anything slower is a hung helper. */
const GH_CLI_TIMEOUT_MS = 10_000

/** The Credential Manager script compiles a type on first run; that takes a moment. */
const POWERSHELL_TIMEOUT_MS = 20_000

/** The file Git's `store` helper writes. */
const GIT_CREDENTIALS_FILE = '.git-credentials'

/** PowerShell 5.1 on every supported Windows version. */
const POWERSHELL_EXECUTABLE = 'powershell.exe'

/** Arguments that keep Windows PowerShell quiet, non-interactive, and script-tolerant. */
const POWERSHELL_ARGUMENTS: readonly string[] = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']

/** One source's reading, reported after all five have been tried. */
interface SourceReading {
  /** Whether the source exists on this machine. */
  readonly available: boolean
  /** Whether the source applies to this platform. */
  readonly supported: boolean
  /** Candidates it produced, in discovery order. */
  readonly candidates: readonly RawScanCandidate[]
  /** Notes it produced (skipped findings, unsupported platform, missing tools). */
  readonly notes: readonly ScanNote[]
}

/**
 * Run one helper command with `child_process.execFile`.
 * @param file - executable name or path.
 * @param args - arguments, passed as an array so no shell re-parses them.
 * @param options - the read's timeout.
 * @returns the command's stdout.
 * @throws the underlying process error on a nonzero exit, a missing executable, or a timeout.
 */
function runCommandWithExecFile(
  file: string,
  args: readonly string[],
  options: ScanCommandOptions,
): Promise<ScanCommandResult> {
  return new Promise<ScanCommandResult>((resolvePromise, rejectPromise) => {
    execFile(
      file,
      [...args],
      { windowsHide: true, timeout: options.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          rejectPromise(error)
          return
        }
        resolvePromise({ stdout })
      },
    )
  })
}

/**
 * Read the token environment variables.
 * @param environment - the environment to read.
 * @returns one candidate per set, non-blank variable, in {@link ENVIRONMENT_TOKEN_SOURCES} order.
 */
function collectEnvironmentCandidates(
  environment: Readonly<Record<string, string | undefined>>,
): RawScanCandidate[] {
  const candidates: RawScanCandidate[] = []
  for (const source of ENVIRONMENT_TOKEN_SOURCES) {
    for (const name of source.names) {
      const token = environment[name]?.trim()
      if (token === undefined || token.length === 0) continue
      candidates.push({ host: source.host, provider: source.provider, token, source: 'environment' })
    }
  }
  return candidates
}

/**
 * Read `~/.git-credentials`.
 * @param homeDirectory - the operator's home directory.
 * @returns the file's candidates and whether it exists.
 */
async function readGitCredentials(homeDirectory: string): Promise<SourceReading> {
  const file = join(homeDirectory, GIT_CREDENTIALS_FILE)
  if (!existsSync(file)) {
    return { available: false, supported: true, candidates: [], notes: [] }
  }
  try {
    const text = await readFile(file, 'utf8')
    return { available: true, supported: true, candidates: parseGitCredentials(text, 'git-credentials'), notes: [] }
  } catch {
    // The file exists but cannot be read; the source is present, it just
    // produced nothing. The failure is not surfaced because it cannot carry a
    // useful action — a fetch or a permission change is outside this capability.
    return { available: true, supported: true, candidates: [], notes: [] }
  }
}

/**
 * Read `gh auth token`.
 * @param runCommand - the command runner to use.
 * @returns the token candidate when gh is installed and logged in.
 */
async function readGhCli(runCommand: ScanCommandRunner): Promise<SourceReading> {
  try {
    const { stdout } = await runCommand('gh', ['auth', 'token'], { timeoutMs: GH_CLI_TIMEOUT_MS })
    const token = parseGhToken(stdout)
    if (token === undefined) {
      return { available: false, supported: true, candidates: [], notes: [] }
    }
    return {
      available: true,
      supported: true,
      candidates: [{ host: 'github.com', provider: 'github', token, source: 'gh-cli' }],
      notes: [],
    }
  } catch {
    return { available: false, supported: true, candidates: [], notes: [] }
  }
}

/**
 * Keep the last segment of a Windows-qualified credential user name.
 * @param userName - the stored user name, possibly `DOMAIN\user`.
 * @returns the login, or undefined when the stored name is blank.
 */
function loginFromCredentialManagerUser(userName: string): string | undefined {
  const trimmed = userName.trim()
  if (trimmed.length === 0) return undefined
  const separator = trimmed.lastIndexOf('\\')
  const login = separator === -1 ? trimmed : trimmed.slice(separator + 1)
  return login.length === 0 ? undefined : login
}

/**
 * Recover the login a credential URL names, when it names one.
 * @param url - the credential's host URL.
 * @returns the decoded user-info login, or undefined when the URL has none.
 */
function loginFromCredentialUrl(url: URL): string | undefined {
  if (url.username.length === 0) return undefined
  try {
    return decodeURIComponent(url.username)
  } catch {
    return url.username
  }
}

/**
 * Read the Windows Credential Manager through the PowerShell program.
 * @param platform - the host platform.
 * @param runCommand - the command runner to use.
 * @returns the source's reading, including a note explaining an unsupported
 *   platform or an unavailable PowerShell.
 */
async function readCredentialManager(platform: NodeJS.Platform, runCommand: ScanCommandRunner): Promise<SourceReading> {
  if (platform !== 'win32') {
    return {
      available: false,
      supported: false,
      candidates: [],
      notes: [{ code: 'platform-unsupported', detail: 'windows' }],
    }
  }
  let stdout: string
  try {
    const result = await runCommand(
      POWERSHELL_EXECUTABLE,
      [...POWERSHELL_ARGUMENTS, '-Command', CREDENTIAL_MANAGER_SCRIPT],
      { timeoutMs: POWERSHELL_TIMEOUT_MS },
    )
    stdout = result.stdout
  } catch {
    return {
      available: false,
      supported: true,
      candidates: [],
      notes: [{ code: 'tool-missing', detail: 'powershell' }],
    }
  }
  const candidates: RawScanCandidate[] = []
  for (const entry of parseCredentialManagerOutput(stdout)) {
    const targetUrl = credentialManagerTargetUrl(entry.target)
    if (targetUrl === undefined) continue
    let url: URL
    try {
      url = new URL(targetUrl)
    } catch {
      continue
    }
    const token = decodeCredentialBlob(entry.blobBase64)
    if (token.length === 0) continue
    const host = url.host
    if (host.length === 0) continue
    const login = loginFromCredentialManagerUser(entry.userName) ?? loginFromCredentialUrl(url)
    const provider = inferProvider(host)
    candidates.push({
      host,
      ...(provider === undefined ? {} : { provider }),
      token,
      ...(login === undefined ? {} : { login }),
      source: 'credential-manager',
    })
  }
  return { available: true, supported: true, candidates, notes: [] }
}

/**
 * Drop repeated credentials, keeping the first (and therefore highest-priority) finding.
 *
 * The same token can be stored by several sources — an exported variable and a
 * `.git-credentials` line, say — and probing it twice would ask the host the
 * same question twice. The key deliberately ignores the login because the host,
 * not the stored name, decides who the token is.
 * @param candidates - candidates in source and discovery order.
 * @returns the candidates with repeats removed, in the same order.
 */
function dedupeCandidates(candidates: readonly RawScanCandidate[]): RawScanCandidate[] {
  const seen = new Set<string>()
  const unique: RawScanCandidate[] = []
  for (const candidate of candidates) {
    const secret = candidate.auth === 'ssh' ? `ssh:${candidate.keyPath ?? ''}` : candidate.token ?? ''
    const key = `${candidate.auth ?? 'token'}|${candidate.provider ?? '?'}|${candidate.host.toLowerCase()}|${secret}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
  }
  return unique
}

/**
 * Read the `~/.ssh/config` key/host pairs as SSH candidates.
 *
 * Only explicit `IdentityFile`/`Host` pairs become candidates; a key that the
 * configuration does not attribute to a host stays a note, because probing every
 * key against every host is not what one click should do.
 * @param homeDirectory - the operator's home directory.
 * @returns the SSH candidates, in configuration order.
 */
async function readSshKeys(homeDirectory: string): Promise<SourceReading> {
  const pairs = await collectSshKeyCandidates(homeDirectory)
  return {
    available: pairs.length > 0,
    supported: true,
    candidates: pairs.map(pair => ({
      host: pair.host,
      ...pair.provider === undefined ? {} : { provider: pair.provider },
      auth: 'ssh' as const,
      keyPath: pair.keyPath,
      source: 'ssh' as const,
    })),
    notes: [],
  }
}

/**
 * Report the sources in {@link SCAN_SOURCES} order, whatever order they were read in.
 * @param readings - one reading per source id.
 * @returns one status per source id, in the shared constant's order.
 */
function buildSourceStatuses(readings: Readonly<Record<ScanSourceId, SourceReading>>): ScanSourceStatus[] {
  return SCAN_SOURCES.map(id => ({
    id,
    available: readings[id].available,
    supported: readings[id].supported,
  }))
}

/**
 * Scan this machine's existing Git authorizations.
 *
 * The sources are read one after another in a fixed order so the result is
 * deterministic and a slow helper cannot reorder findings: environment
 * variables, `~/.git-credentials`, the `gh` CLI, the Windows Credential
 * Manager, then the SSH configuration's key/host pairs. A source that is absent
 * on this machine contributes no candidates and is reported unavailable; a
 * source that cannot apply to this platform (the Credential Manager off Windows)
 * is also reported unsupported. Nothing here verifies a token or a key, throws
 * on a missing helper, or writes to disk.
 * @param environment - platform, home directory, environment, and optional runner.
 * @returns every candidate found, all five source statuses, and the caveats.
 */
export async function scanAuthorizations(environment: ScanEnvironment): Promise<RawScanResult> {
  const runCommand = environment.runCommand ?? runCommandWithExecFile

  const environmentCandidates = collectEnvironmentCandidates(environment.environment)
  const gitCredentials = await readGitCredentials(environment.homeDirectory)
  const ghCli = await readGhCli(runCommand)
  const credentialManager = await readCredentialManager(environment.platform, runCommand)
  const sshKeys = await readSshKeys(environment.homeDirectory)
  const sshNotes = await collectSshNotes(environment.homeDirectory)

  const readings: Record<ScanSourceId, SourceReading> = {
    environment: {
      available: environmentCandidates.length > 0,
      supported: true,
      candidates: environmentCandidates,
      notes: [],
    },
    'git-credentials': gitCredentials,
    'gh-cli': ghCli,
    'credential-manager': credentialManager,
    ssh: sshKeys,
  }

  const candidates = dedupeCandidates([
    ...environmentCandidates,
    ...gitCredentials.candidates,
    ...ghCli.candidates,
    ...credentialManager.candidates,
    ...sshKeys.candidates,
  ])

  return {
    candidates,
    sources: buildSourceStatuses(readings),
    notes: [...credentialManager.notes, ...sshNotes],
  }
}
