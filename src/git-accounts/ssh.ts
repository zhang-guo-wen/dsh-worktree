/**
 * SSH-key authentication for Git accounts.
 *
 * A Git remote can be reached over SSH with a private key and no provider API
 * token, but the provider APIs this capability reads cannot be asked "which
 * projects can this key reach": SSH authorizes Git transport, not REST. So an
 * SSH account is stored for what it is — a key that a host accepts as a login —
 * and the project list stays the token accounts' job.
 *
 * Verification is one `ssh -T git@<host>`: the banner a host prints on success
 * names the account (`Hi <login>!`, `Welcome to GitLab, @<login>!`), which is how
 * an SSH key becomes a row with a login instead of an opaque path. The probe is
 * non-interactive by construction — `BatchMode=yes` makes an encrypted key fail
 * instead of waiting for a prompt — and it writes host keys to a scratch
 * `known_hosts`, so the operator's own SSH configuration is never modified.
 *
 * The private key's contents are never read: this module hands the path to
 * `ssh -i` and nothing else.
 * @module @guowenzhang/dsh-worktree/git-accounts/ssh
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { inferProvider } from './scan-parsers.ts'
import type { AccountProfile } from './providers.ts'
import type { GitProvider, GitSshKey } from './types.ts'

/** File names that hold an SSH private key; a `.pub` sibling is a public key. */
const PRIVATE_KEY_NAME = /^id_[A-Za-z0-9._-]+$/u

/** How many private keys one read offers the operator. */
const MAX_KEYS = 12

/** How many SSH candidates one scan verifies; a key ring must not turn one click into minutes. */
const MAX_CANDIDATES = 6

/**
 * Bound on one verification, in milliseconds.
 *
 * A reachable host answers in well under a second, so five seconds is generous.
 * When a host has an SSH-over-443 fallback the first endpoint gets the first
 * three seconds and the fallback the rest, so the whole verification still ends
 * at this budget instead of spending it twice.
 */
const PROBE_BUDGET_MS = 5_000

/** Share of {@link PROBE_BUDGET_MS} the first endpoint may use when a fallback exists. */
const PRIMARY_PROBE_MS = 3_000

/** TCP connect bound handed to OpenSSH itself, in seconds; the process budget above is the backstop. */
const CONNECT_TIMEOUT_SECONDS = 5

/**
 * SSH-over-443 fallbacks for the two hosts that publish one.
 *
 * A network that drops outbound port 22 (common behind restrictive middleboxes)
 * still reaches GitHub and GitLab on 443, where both run the same SSH service.
 * The account keeps its browser/API host (`github.com`); only the probe uses the
 * alternate endpoint, and the result reports which endpoint answered.
 */
const SSH_FALLBACKS: Partial<Record<GitProvider, { readonly hostname: string; readonly port: string }>> = {
  github: { hostname: 'ssh.github.com', port: '443' },
  gitlab: { hostname: 'altssh.gitlab.com', port: '443' },
}

/** A key file name a note or dialog can show without opening the file. */
const KEY_FILE_NAME = /^[^\\/:*?"<>|]+$/u

/** One verification failure, classified for the account capability. */
export class SshVerificationError extends Error {
  /**
   * @param code - failure class this module can tell apart.
   * @param message - actionable text; never key contents.
   */
  constructor(
    readonly code: 'invalid_input' | 'unauthorized' | 'network' | 'provider_unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'SshVerificationError'
  }
}

/** What a host's SSH banner said about the connecting key. */
export interface SshBanner {
  /** Whether the banner reports a successful authentication at all. */
  readonly authenticated: boolean
  /** The account login the banner names, when it names one. */
  readonly login?: string
  /** Host family the banner's wording identifies, when it is recognizable. */
  readonly provider?: GitProvider
}

/**
 * Read a host's `ssh -T` banner.
 *
 * Each host family words the success line differently, and the login is the only
 * fact worth extracting. An authentication success without a recognizable name
 * still reports `authenticated`, so a caller can distinguish "the key works but
 * cannot be attributed" from "the key was refused". The wording also identifies
 * the host family, which is how a scan can place a self-hosted host whose domain
 * does not name its platform.
 * @param output - the probe's stdout and stderr, concatenated.
 * @returns whether the key authenticated and, when the host names them, its login and family.
 */
export function parseSshBanner(output: string): SshBanner {
  // Gitee's "Hi <login>!" line shares GitHub's opening, so its host-specific
  // tail (GITEE.COM) must be matched before the GitHub wording.
  const giteeHi = /Hi\s+([^!\r\n]+)!\s+You've successfully authenticated,\s+but\s+GITEE\.COM/iu.exec(output)
  if (giteeHi?.[1] !== undefined) return { authenticated: true, login: giteeHi[1].trim(), provider: 'gitee' }
  const github = /Hi\s+([^!\r\n]+)!\s+You've successfully authenticated/iu.exec(output)
  if (github?.[1] !== undefined) return { authenticated: true, login: github[1].trim(), provider: 'github' }
  const gitlab = /Welcome to GitLab,\s*@?([^\s!]+)!/iu.exec(output)
  if (gitlab?.[1] !== undefined) return { authenticated: true, login: gitlab[1].trim(), provider: 'gitlab' }
  const giteeWelcome = /Welcome to Gitee\.com,\s*([^!\r\n]+)!/iu.exec(output)
  if (giteeWelcome?.[1] !== undefined) return { authenticated: true, login: giteeWelcome[1].trim(), provider: 'gitee' }
  if (/successfully authenticated/iu.test(output)) return { authenticated: true }
  return { authenticated: false }
}

/**
 * Expand a leading `~` and make a path absolute against the operator's home.
 * @param path - a path as typed or as written in `~/.ssh/config`.
 * @param home - the home directory to expand against.
 * @returns the absolute path.
 */
export function expandKeyPath(path: string, home: string = homedir()): string {
  const trimmed = path.trim()
  if (trimmed === '~') return home
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return resolve(home, trimmed.slice(2))
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(home, trimmed)
}

/**
 * Whether a path names a private key file that exists.
 * @param keyPath - absolute or `~`-relative path.
 * @param home - the home directory to expand against.
 * @returns the absolute path when the file exists.
 * @throws {SshVerificationError} when the path is not a file.
 */
export async function resolveExistingKey(keyPath: string, home?: string): Promise<string> {
  const absolute = expandKeyPath(keyPath, home)
  let isFile = false
  try {
    isFile = (await stat(absolute)).isFile()
  } catch {
    isFile = false
  }
  if (!isFile) throw new SshVerificationError('invalid_input', `the SSH key file ${JSON.stringify(absolute)} does not exist`)
  return absolute
}

/**
 * Read the private keys this machine offers: `id_*` files in `~/.ssh` plus the
 * explicit `IdentityFile` values in its config.
 * @param homeDirectory - the operator's home directory.
 * @returns the existing private key paths, deduplicated and ordered by name.
 */
export async function listSshKeys(homeDirectory: string = homedir()): Promise<GitSshKey[]> {
  const sshDirectory = join(homeDirectory, '.ssh')
  const found = new Map<string, GitSshKey>()
  let entries: string[] = []
  try {
    entries = (await readdir(sshDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
  } catch {
    entries = []
  }
  const add = (path: string, name: string): void => {
    if (found.size >= MAX_KEYS || !KEY_FILE_NAME.test(name)) return
    found.set(path, { path, name })
  }
  for (const name of entries.sort()) {
    if (PRIVATE_KEY_NAME.test(name) && !name.endsWith('.pub')) add(join(sshDirectory, name), name)
  }
  for (const block of await readSshConfig(sshDirectory)) {
    for (const identity of block.identityFiles) {
      const path = expandKeyPath(identity, homeDirectory)
      if (!found.has(path)) add(path, basename(path))
    }
  }
  return [...found.values()].slice(0, MAX_KEYS)
}

/** One `Host` block of `~/.ssh/config`, reduced to the facts this module needs. */
interface SshConfigBlock {
  /** Explicit private key paths, as written in the file. */
  readonly identityFiles: string[]
  /** The host the block resolves to: its `HostName`, else its first non-wildcard `Host` alias. */
  readonly host: string | undefined
}

/**
 * Read `~/.ssh/config` into host blocks.
 * @param sshDirectory - the `.ssh` directory.
 * @returns the blocks in file order; empty when the file is absent.
 */
async function readSshConfig(sshDirectory: string): Promise<SshConfigBlock[]> {
  let text: string
  try {
    text = await readFile(join(sshDirectory, 'config'), 'utf8')
  } catch {
    return []
  }
  const blocks: SshConfigBlock[] = []
  let identityFiles: string[] = []
  let hostName: string | undefined
  let aliases: string[] = []
  const flush = (): void => {
    const host = hostName ?? aliases.find(alias => !alias.includes('*') && !alias.includes('?'))
    if (host !== undefined || identityFiles.length > 0) blocks.push({ identityFiles, host })
    identityFiles = []
    hostName = undefined
    aliases = []
  }
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z][A-Za-z0-9]*)[ \t]+(.+)$/u.exec(line)
    if (match === null) continue
    const key = match[1]!.toLowerCase()
    const value = match[2]!.trim()
    if (key === 'host') {
      flush()
      aliases = value.split(/[ \t]+/u).filter(alias => alias !== '')
      continue
    }
    if (key === 'hostname') hostName = unquote(value)
    else if (key === 'identityfile') identityFiles.push(unquote(value))
  }
  flush()
  return blocks
}

/**
 * Strip the quotes an SSH config value may carry.
 * @param value - the raw value.
 * @returns the bare value.
 */
function unquote(value: string): string {
  const quoted = /^"(.*)"$/u.exec(value) ?? /^'(.*)'$/u.exec(value)
  return quoted?.[1] ?? value
}

/** One SSH candidate a scan can verify. */
export interface SshKeyCandidate {
  /** Absolute path of the private key. */
  readonly keyPath: string
  /** Host the configuration points this key at. */
  readonly host: string
  /** Host family the host names, when it names one. */
  readonly provider?: GitProvider
}

/**
 * Read the `~/.ssh/config` pairs that name a known Git host and an explicit
 * private key.
 *
 * Only explicit `IdentityFile` entries for a recognized host become candidates:
 * an unconfigured key ring cannot be attributed to a host without probing every
 * combination, and a scan that quietly opens several SSH connections per key is
 * not what one click should do. A private key for a host the inference cannot
 * place is still reported as a note, and the add dialog can verify it manually.
 * @param homeDirectory - the operator's home directory.
 * @returns at most {@link MAX_CANDIDATES} key/host pairs, deduplicated.
 */
export async function collectSshKeyCandidates(homeDirectory: string = homedir()): Promise<SshKeyCandidate[]> {
  const blocks = await readSshConfig(join(homeDirectory, '.ssh'))
  const candidates: SshKeyCandidate[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    if (block.host === undefined) continue
    const provider = inferProvider(block.host)
    // Only a host the inference places is probed automatically: connecting to an
    // arbitrary configured host is outside what one scan should do.
    if (provider === undefined) continue
    for (const identity of block.identityFiles) {
      const keyPath = expandKeyPath(identity, homeDirectory)
      const key = `${provider}|${block.host}|${keyPath}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ keyPath, host: block.host, provider })
      if (candidates.length === MAX_CANDIDATES) return candidates
    }
  }
  return candidates
}

/** What one SSH probe is asked to verify. */
export interface SshProbeRequest {
  /** Host family, used only to shape the failure text. */
  readonly provider: GitProvider
  /** Host that serves the account; may carry a non-default `:port`. */
  readonly host: string
  /** Private key path, absolute or `~`-relative. */
  readonly keyPath: string
  /** Bound on the whole verification; defaults to the five-second probe budget. */
  readonly timeoutMs?: number
}

/** One successful SSH verification. */
export interface SshProbeResult {
  /** The account facts the banner gave. */
  readonly profile: AccountProfile
  /** Host family the banner identified, when its wording is recognizable. */
  readonly provider?: GitProvider
  /** The endpoint that answered, `hostname:port`; present when a fallback answered. */
  readonly endpoint?: string
}

/**
 * Verify one private key against one host and read the account login.
 *
 * The probe is `ssh -T git@<hostname>` with batch mode, an isolated scratch
 * `known_hosts`, and the selected key only. A host that authenticates prints its
 * banner before closing the session — GitHub exits nonzero after a successful
 * authentication, so the banner decides, not the exit status. When `github.com`
 * or `gitlab.com` is unreachable on 22 and the host has a published SSH-over-443
 * endpoint, that endpoint is tried once before failing.
 * @param request - provider, host, key path, and timeout.
 * @returns the host's profile facts for the key and the family its banner names.
 * @throws {SshVerificationError} when the key is unusable, refused, or the host is unreachable.
 */
export async function verifySshKey(request: SshProbeRequest): Promise<SshProbeResult> {
  const keyPath = await resolveExistingKey(request.keyPath)
  const targets = sshProbeEndpoints(request.provider, request.host)
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-worktree-ssh-'))
  const knownHosts = join(scratch, 'known_hosts')
  try {
    await writeFile(knownHosts, '')
    let lastError: SshVerificationError | undefined
    for (const [index, target] of targets.entries()) {
      try {
        return await probeTarget(target, keyPath, knownHosts, request.provider, probeTimeout(request.timeoutMs, targets.length, index))
      } catch (error: unknown) {
        if (!(error instanceof SshVerificationError)) throw error
        lastError = error
        const hasFallback = index + 1 < targets.length
        if (!hasFallback || error.code !== 'network') throw error
      }
    }
    if (lastError !== undefined && targets.length > 1) {
      const tried = targets.map(target => `${target.hostname}:${target.port ?? '22'}`).join(' and ')
      throw new SshVerificationError('network', `could not reach ${request.host} over SSH (tried ${tried})`)
    }
    throw lastError ?? new SshVerificationError('network', `could not reach ${request.host} over SSH`)
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

/** One SSH endpoint a probe can dial. */
interface ProbeTarget {
  /** Host name to connect to. */
  readonly hostname: string
  /** Port to connect to; undefined means ssh's own default of 22. */
  readonly port: string | undefined
}

/**
 * Build the endpoints one verification may try: the host as entered, then the
 * published SSH-over-443 fallback when the host is a canonical github/gitlab one
 * and no custom port was named. Exported for the SSH spec, which pins the
 * fallback order without opening a connection.
 * @param provider - host family.
 * @param host - normalized host, possibly `host:port`.
 * @returns the endpoints in the order they are tried.
 */
export function sshProbeEndpoints(provider: GitProvider, host: string): ProbeTarget[] {
  const primary = splitHostPort(host)
  const targets: ProbeTarget[] = [primary]
  const fallback = SSH_FALLBACKS[provider]
  if (primary.port === undefined && fallback !== undefined
    && primary.hostname === (provider === 'github' ? 'github.com' : 'gitlab.com')) {
    targets.push(fallback)
  }
  return targets
}

/**
 * Probe one endpoint and turn its banner into a result.
 * @param target - the endpoint to dial.
 * @param keyPath - resolved private key path.
 * @param knownHosts - scratch known-hosts file shared by one verification's attempts.
 * @param provider - host family, for the failure text.
 * @param timeoutMs - this attempt's process bound.
 * @returns the verified result.
 * @throws {SshVerificationError} when the probe is refused or unreachable.
 */
async function probeTarget(
  target: ProbeTarget,
  keyPath: string,
  knownHosts: string,
  provider: GitProvider,
  timeoutMs: number,
): Promise<SshProbeResult> {
  const args = [
    '-T',
    '-i', keyPath,
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHosts}`,
    '-o', `ConnectTimeout=${String(CONNECT_TIMEOUT_SECONDS)}`,
    ...target.port === undefined ? [] : ['-p', target.port],
    `git@${target.hostname}`,
  ]
  const output = await runSsh(args, timeoutMs)
  const banner = parseSshBanner(output)
  if (banner.authenticated && banner.login !== undefined && banner.login !== '') {
    return {
      profile: { login: banner.login },
      ...banner.provider === undefined ? {} : { provider: banner.provider },
      ...target.port === undefined ? {} : { endpoint: `${target.hostname}:${target.port}` },
    }
  }
  if (banner.authenticated) {
    throw new SshVerificationError('provider_unavailable',
      'the host accepted the SSH key but its banner named no account, so the login cannot be recorded')
  }
  throw classifyProbeFailure(output, provider, target.hostname)
}

/**
 * Split a host that may carry a port into its SSH parts.
 * @param host - a normalized host such as `gitlab.example.com` or `host:2222`.
 * @returns the hostname and, when present, the port.
 */
function splitHostPort(host: string): { hostname: string; port: string | undefined } {
  const match = /^(.*):(\d{1,5})$/u.exec(host)
  if (match === null) return { hostname: host, port: undefined }
  return { hostname: match[1]!, port: match[2]! }
}

/**
 * The process bound one attempt gets.
 * @param override - a caller-supplied bound, used verbatim for every attempt.
 * @param attempts - how many endpoints this verification may try.
 * @param index - the attempt's position.
 * @returns milliseconds for this attempt.
 */
function probeTimeout(override: number | undefined, attempts: number, index: number): number {
  if (override !== undefined) return override
  if (attempts <= 1) return PROBE_BUDGET_MS
  return index === 0 ? PRIMARY_PROBE_MS : PROBE_BUDGET_MS - PRIMARY_PROBE_MS
}

/**
 * Run one `ssh` probe and return its stdout and stderr together.
 *
 * A nonzero exit is this probe's normal answer for both success-with-banner and
 * refusal, so the caller classifies the output; only a spawn-level failure
 * (no `ssh` executable) is thrown here.
 * @param args - ssh arguments.
 * @param timeoutMs - bound on the probe.
 * @returns stdout followed by stderr.
 * @throws {SshVerificationError} when `ssh` cannot be started or the probe times out.
 */
async function runSsh(args: readonly string[], timeoutMs: number): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    execFile('ssh', [...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`
      if (error === null) {
        resolvePromise(output)
        return
      }
      const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string }
      if (failure.code === 'ENOENT') {
        rejectPromise(new SshVerificationError('provider_unavailable',
          'the OpenSSH client (ssh) was not found on the Host PATH, so SSH accounts cannot be verified'))
        return
      }
      if (failure.killed === true) {
        const seconds = Math.round(timeoutMs / 1000)
        rejectPromise(new SshVerificationError('network', `the SSH probe timed out after ${String(seconds)} seconds`))
        return
      }
      resolvePromise(output)
    })
  })
}

/**
 * Classify a probe that printed no success banner.
 * @param output - the probe's stdout and stderr.
 * @param provider - host family, for the message.
 * @param hostname - host that was probed.
 * @returns the failure to throw.
 */
function classifyProbeFailure(output: string, provider: GitProvider, hostname: string): SshVerificationError {
  if (/permission denied\s*\(publickey/i.test(output)) {
    return new SshVerificationError('unauthorized', `the ${provider} host refused this SSH key (publickey permission denied)`)
  }
  if (/enter passphrase|passphrase/iu.test(output)) {
    return new SshVerificationError('invalid_input',
      'the SSH key is encrypted; load it into ssh-agent (or use an unencrypted key) before adding the account')
  }
  if (/could not resolve hostname|connection timed out|connection refused|network is unreachable|no route to host|host is unreachable/iu.test(output)) {
    return new SshVerificationError('network', `could not reach ${hostname} over SSH`)
  }
  if (/no such identity|identity file .* not accessible|could not open/i.test(output)) {
    return new SshVerificationError('invalid_input', 'the SSH key file could not be read by the OpenSSH client')
  }
  if (/host key verification failed/iu.test(output)) {
    return new SshVerificationError('provider_unavailable', `the SSH host key for ${hostname} did not verify`)
  }
  const firstLine = output.split(/\r?\n/u).map(line => line.trim()).find(line => line !== '') ?? 'no diagnostic'
  return new SshVerificationError('provider_unavailable',
    `SSH verification against ${hostname} failed: ${firstLine.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 300)}`)
}
