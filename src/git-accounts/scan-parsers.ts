/**
 * Pure parsers behind the machine authorization scan.
 *
 * Every export here is a value transform over text that another module already
 * read, except {@link collectSshNotes}, which inspects file NAMES under
 * `<home>/.ssh` and the small `config` text file. No parser opens a network
 * connection, spawns a process, or reads a private key's contents, which is
 * what lets the scan spec exercise every branch against fixtures and temporary
 * directories instead of the operator's real credentials.
 * @module @guowenzhang/dsh-worktree/git-accounts/scan-parsers
 */

import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import type { RawScanCandidate } from './scan.ts'
import type { GitProvider, ScanNote } from './types.ts'

/** One entry the Credential Manager script emits; the credential blob stays base64. */
export interface CredentialManagerEntry {
  /** Stored target name, e.g. `git:https://github.com`. */
  readonly target: string
  /** Stored user name; Windows may qualify it as `DOMAIN\user`. */
  readonly userName: string
  /** Credential blob exactly as Windows stores it, base64-encoded. */
  readonly blobBase64: string
}

/**
 * Targets whose value is a Git credential. Anything else in the store — web
 * logons, RDP passwords, application secrets — is never read past its target
 * name, so a scan cannot leak an unrelated secret.
 */
const GIT_TARGET = /^(?:git:|LegacyGeneric:target=git:|git-credential)/i

/** Prefixes a Git credential target wears before the URL it names. */
const TARGET_PREFIX = /^(?:LegacyGeneric:target=|git-credential-manager:|git-credential:|git:)/i

/** File names that hold an SSH private key; a `.pub` sibling is a public key. */
const SSH_PRIVATE_KEY_NAME = /^id_[A-Za-z0-9._-]+$/
const SSH_PUBLIC_KEY_NAME = /\.pub$/i

/** How many SSH findings one note may name, so a large key ring stays readable. */
const MAX_SSH_NOTE_DETAILS = 5

/**
 * Decode a URL component, keeping the raw text when its escapes are malformed.
 *
 * `URL` leaves the user info percent-encoded, and a hand-written
 * `.git-credentials` line may contain a bare `%`; a decode failure must skip
 * the escape, not the whole line.
 * @param value - percent-encoded component text.
 * @returns the decoded text, or the input when it is not valid percent-encoding.
 */
function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Strip every Git-credential target prefix, outermost first.
 * @param target - a Credential Manager target name.
 * @returns the remainder, which is expected to be a URL.
 */
function stripTargetPrefixes(target: string): string {
  let rest = target
  for (;;) {
    const stripped = rest.replace(TARGET_PREFIX, '')
    if (stripped === rest) return rest
    rest = stripped
  }
}

/**
 * Parse `~/.git-credentials`, Git's `store` helper file.
 *
 * One credential per line: `https://user:token@host`. Both `https` and `http`
 * are accepted (`http` is the scheme a self-hosted host on a trusted network
 * uses; this scan only reads what Git already stored and never sends it
 * anywhere), and lines that are not a complete credential are skipped rather
 * than reported, because a malformed line names no candidate to probe.
 * @param text - the file's contents.
 * @param source - the scan source to tag the candidates with; always `git-credentials`.
 * @returns one candidate per complete credential line, in file order.
 */
export function parseGitCredentials(text: string, source: 'git-credentials'): RawScanCandidate[] {
  const candidates: RawScanCandidate[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    let url: URL
    try {
      url = new URL(line)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    if (url.username.length === 0 || url.password.length === 0) continue
    const host = url.host
    const provider = inferProvider(host)
    candidates.push({
      host,
      ...(provider === undefined ? {} : { provider }),
      token: decodeUrlComponent(url.password),
      login: decodeUrlComponent(url.username),
      source,
    })
  }
  return candidates
}

/**
 * Parse the JSON the Credential Manager script printed.
 *
 * The script emits an array, but a single stored credential can serialize as
 * one object depending on how the host serializes it, so both shapes are
 * accepted. A leading byte-order mark is tolerated because Windows PowerShell's
 * redirected stdout may prepend one. Entries are filtered to Git credential
 * targets here, before any caller can look at their blobs.
 * @param stdout - the script's stdout.
 * @returns the Git credential entries, in output order; empty when the text is
 *   empty, malformed, or names no Git credential.
 */
export function parseCredentialManagerOutput(stdout: string): CredentialManagerEntry[] {
  const text = stdout.replace(/^\uFEFF/, '').trim()
  if (text.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  const entries: CredentialManagerEntry[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const record = row as Record<string, unknown>
    const target = typeof record.target === 'string' ? record.target : undefined
    if (target === undefined || target.length === 0 || !GIT_TARGET.test(target)) continue
    const userName = typeof record.userName === 'string' ? record.userName : ''
    const blobBase64 = typeof record.blobBase64 === 'string' ? record.blobBase64 : ''
    entries.push({ target, userName, blobBase64 })
  }
  return entries
}

/**
 * Decode a Credential Manager blob into the token it stores.
 *
 * Windows Credential Manager stores a generic credential's blob as UTF-16LE
 * when the writer passed Unicode, while other writers (git-credential-manager
 * among them) store UTF-8. The two are told apart by shape: an even number of
 * bytes whose odd positions are all zero is the UTF-16LE form of a text value;
 * anything else is decoded as UTF-8. Trailing NUL padding and surrounding
 * whitespace are dropped, since neither is part of the password.
 * @param base64 - the blob, base64-encoded.
 * @returns the stored text; empty when the input is empty or undecodable.
 */
export function decodeCredentialBlob(base64: string): string {
  const trimmed = base64.trim()
  if (trimmed.length === 0) return ''
  const bytes = Buffer.from(trimmed, 'base64')
  if (bytes.length === 0) return ''
  if (bytes.length % 2 === 0) {
    let utf16 = true
    for (let index = 1; index < bytes.length; index += 2) {
      if (bytes[index] !== 0) {
        utf16 = false
        break
      }
    }
    if (utf16) return bytes.toString('utf16le').replace(/\u0000+$/, '').trim()
  }
  return bytes.toString('utf8').replace(/\u0000+$/, '').trim()
}

/**
 * Pull the token `gh auth token` prints.
 * @param stdout - the command's stdout.
 * @returns the trimmed token, or undefined when the command printed nothing.
 */
export function parseGhToken(stdout: string): string | undefined {
  const token = stdout.trim()
  return token.length === 0 ? undefined : token
}

/**
 * Infer a host family from a host name.
 *
 * The three public hosts are matched exactly; a self-hosted instance is
 * recognized by its name containing the provider's name (for example
 * `gitlab.arcuchi.com`). A host whose family cannot be inferred keeps no
 * provider, and the account service then probes it instead of guessing.
 * @param host - a host name, optionally with a port.
 * @returns the host family, or undefined when the name names none.
 */
export function inferProvider(host: string): GitProvider | undefined {
  const normalized = host.trim().toLowerCase()
  if (normalized.length === 0) return undefined
  if (normalized === 'github.com') return 'github'
  if (normalized === 'gitlab.com') return 'gitlab'
  if (normalized === 'gitee.com') return 'gitee'
  if (normalized.includes('gitlab')) return 'gitlab'
  if (normalized.includes('gitee')) return 'gitee'
  if (normalized.includes('github')) return 'github'
  return undefined
}

/**
 * Recover the URL a Credential Manager Git target names.
 *
 * Windows stores the same credential under a few target spellings
 * (`git:https://github.com`, `LegacyGeneric:target=git:https://github.com`,
 * `git-credential:...`); each spelling is a prefix in front of the host URL.
 * @param target - a Credential Manager target name.
 * @returns the normalized URL, or undefined when the remainder is not an
 *   absolute http(s) URL.
 */
export function credentialManagerTargetUrl(target: string): string | undefined {
  const trimmed = target.trim()
  if (trimmed.length === 0) return undefined
  const remainder = stripTargetPrefixes(trimmed)
  if (remainder === trimmed) return undefined
  let url: URL
  try {
    url = new URL(remainder)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (url.hostname.length === 0) return undefined
  return url.href
}

/**
 * Read the hosts and key names an SSH client configuration mentions.
 * @param configPath - absolute path of `.ssh/config`.
 * @returns the `Host` aliases (wildcards excluded), `HostName` values, and
 *   `IdentityFile` basenames, in file order; empty when the file is missing.
 */
async function collectSshConfigDetails(configPath: string): Promise<string[]> {
  let text: string
  try {
    text = await readFile(configPath, 'utf8')
  } catch {
    return []
  }
  const details: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const match = /^([A-Za-z]+)\s+(.+)$/.exec(line)
    if (match === null) continue
    const directive = match[1]!.toLowerCase()
    const value = match[2]!.trim()
    if (directive === 'host') {
      for (const alias of value.split(/\s+/)) {
        if (alias.length === 0 || alias.includes('*') || alias.includes('?')) continue
        details.push(alias)
      }
    } else if (directive === 'hostname') {
      details.push(value)
    } else if (directive === 'identityfile') {
      details.push(basename(value.replace(/^["']|["']$/g, '')))
    }
  }
  return details
}

/**
 * Report SSH keys and configured hosts as a note the page can explain.
 *
 * An SSH key authorizes Git transport, not the provider REST API: a key that
 * `~/.ssh/config` pairs with a known host can become an SSH account (that
 * candidate list lives in `ssh.ts`), but it can never list projects. The note
 * tells the operator which keys and hosts were seen, including any key no scan
 * pair covers. Only file names and config text are inspected — a private key
 * file is never opened.
 * @param homeDirectory - the operator's home directory.
 * @returns one note naming at most five findings, or none when `.ssh` has none.
 */
export async function collectSshNotes(homeDirectory: string): Promise<ScanNote[]> {
  const sshDirectory = join(homeDirectory, '.ssh')
  let entries: Dirent[]
  try {
    entries = await readdir(sshDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  const details: string[] = []
  const keyNames = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => SSH_PRIVATE_KEY_NAME.test(name) && !SSH_PUBLIC_KEY_NAME.test(name))
    .sort()
  details.push(...keyNames)
  details.push(...(await collectSshConfigDetails(join(sshDirectory, 'config'))))
  const unique: string[] = []
  for (const detail of details) {
    if (!unique.includes(detail)) unique.push(detail)
    if (unique.length === MAX_SSH_NOTE_DETAILS) break
  }
  if (unique.length === 0) return []
  return [{ code: 'ssh-keys-found', detail: unique.join(', ') }]
}

/**
 * The PowerShell program the scan spawns on Windows.
 *
 * It P/Invokes `advapi32!CredEnumerateW` for generic credentials, keeps only
 * entries whose target names a Git credential, base64-encodes each blob, and
 * prints one compressed JSON array — `[]` when there is nothing to report. The
 * outer guard turns a missing `advapi32` (or an older host that cannot compile
 * the type) into `[]` instead of a failing exit, so the scan can report an
 * empty Windows credential store accurately. The script never prompts; the
 * scan still spawns it with `-NonInteractive` so an unexpected prompt fails
 * fast instead of waiting for a console that is not attached.
 */
export const CREDENTIAL_MANAGER_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
try {
  try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }
  $source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DshGitCredentialStore
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public sealed class Entry
    {
        public string target { get; set; }
        public string userName { get; set; }
        public string blobBase64 { get; set; }
    }

    [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredEnumerate(string filter, int flags, out int count, out IntPtr credentials);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    private static bool IsGitTarget(string target)
    {
        if (target == null || target.Length == 0)
            return false;
        if (target.StartsWith("git:", StringComparison.OrdinalIgnoreCase))
            return true;
        if (target.StartsWith("LegacyGeneric:target=git:", StringComparison.OrdinalIgnoreCase))
            return true;
        return target.StartsWith("git-credential", StringComparison.OrdinalIgnoreCase);
    }

    public static Entry[] Read()
    {
        int count;
        IntPtr credentials;
        if (!CredEnumerate(null, 0, out count, out credentials))
            return new Entry[0];
        List<Entry> entries = new List<Entry>();
        try
        {
            for (int index = 0; index < count; index++)
            {
                IntPtr pointer = Marshal.ReadIntPtr(credentials, index * IntPtr.Size);
                CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
                if (!IsGitTarget(credential.TargetName))
                    continue;
                byte[] blob = new byte[0];
                if (credential.CredentialBlobSize > 0 && credential.CredentialBlob != IntPtr.Zero)
                {
                    blob = new byte[credential.CredentialBlobSize];
                    Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
                }
                Entry entry = new Entry();
                entry.target = credential.TargetName == null ? string.Empty : credential.TargetName;
                entry.userName = credential.UserName == null ? string.Empty : credential.UserName;
                entry.blobBase64 = Convert.ToBase64String(blob);
                entries.Add(entry);
            }
        }
        finally
        {
            CredFree(credentials);
        }
        return entries.ToArray();
    }
}
'@
  Add-Type -TypeDefinition $source -Language CSharp
  $entries = [DshGitCredentialStore]::Read()
  if ($null -eq $entries -or $entries.Count -eq 0) {
    [Console]::Out.Write('[]')
  } else {
    [Console]::Out.Write((ConvertTo-Json -InputObject @($entries) -Compress -Depth 3))
  }
} catch {
  [Console]::Out.Write('[]')
}`
