/**
 * The Git-accounts capability's shared vocabulary.
 *
 * Both halves of the plugin compile against this file: the Host builds account
 * summaries, project pages, and scan outcomes, and the browser renders them.
 * Nothing here imports anything — no Node module and no browser module — because
 * the page bundle must be able to read it without pulling a Host dependency in,
 * and the Host must not depend on the page's api client. The wire types are
 * deliberately narrower than the Host's stored record: a token has no field here,
 * so no route, injected face, or component can carry one by accident.
 *
 * The capability answers four questions for one operator:
 * - which Git hosts this machine can already push to (accounts),
 * - what the operator's Git identity is (name and email in global config),
 * - which of the operator's own projects each account can list,
 * - and what a scan of this machine's existing authorizations found.
 * @module @guowenzhang/dsh-worktree/git-accounts/types
 */

/** The three hosts this capability speaks to. */
export const GIT_PROVIDERS = ['github', 'gitlab', 'gitee'] as const

/** One supported Git host family. */
export type GitProvider = (typeof GIT_PROVIDERS)[number]

/**
 * Each provider's public host, used as the form's placeholder and the value a
 * scan assumes when a stored credential names no host. A self-hosted GitLab or
 * GitHub Enterprise instance replaces the host and keeps the provider.
 */
export const DEFAULT_PROVIDER_HOSTS: Readonly<Record<GitProvider, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  gitee: 'gitee.com',
}

/** Where one stored account's credential came from. */
export const ACCOUNT_ORIGINS = [
  'manual', 'credential-manager', 'git-credentials', 'gh-cli', 'environment', 'ssh-key',
] as const

/** One account's provenance, so the page can say where a discovered account came from. */
export type AccountOrigin = (typeof ACCOUNT_ORIGINS)[number]

/** How an account proves itself to its host. */
export const GIT_AUTH_METHODS = ['token', 'ssh'] as const

/** One account's authentication method. */
export type GitAuthMethod = (typeof GIT_AUTH_METHODS)[number]

/** One connected account, as every wire type and the page reports it (never its token or key contents). */
export interface GitAccountSummary {
  /** Credential-record id: `<provider>-<random>`, unique within this plugin's records. */
  readonly id: string
  /** Host family the account speaks. */
  readonly provider: GitProvider
  /** Host that serves the account, e.g. `github.com` or `gitlab.arcuchi.com`. */
  readonly host: string
  /** The host's own login for the account. */
  readonly login: string
  /** How the account authenticates: a stored access token, or an SSH private key on this machine. */
  readonly auth: GitAuthMethod
  /**
   * Whether the host confirmed the credential when it was added.
   *
   * False only for an SSH account saved while the host was unreachable: the key
   * path is stored so Git can use it later, but no login banner was read. A token
   * account is always verified, because the token's whole value is the identity
   * it proves.
   */
  readonly verified: boolean
  /** Display name the host reports, when it reports one. */
  readonly name?: string
  /** Email the host reports publicly, when it reports one. */
  readonly email?: string
  /** The account's profile page on its host. */
  readonly profileUrl?: string
  /** When the account was added or last refreshed, ISO 8601. */
  readonly addedAt: string
  /** How the credential arrived. */
  readonly origin: AccountOrigin
  /** Token scopes the host reported, space-separated, when the host reports them. */
  readonly scopes?: string
}

/** One account's state as the page lists it. */
export interface GitIdentity {
  /** The global `user.name` value, or empty when none is set. */
  readonly name: string
  /** The global `user.email` value, or empty when none is set. */
  readonly email: string
  /** Whether the Host could read Git's global configuration at all. */
  readonly available: boolean
  /** Why the read failed, as a machine code the page localizes; present when `available` is false. */
  readonly error?: 'git_missing' | 'git_failed'
}

/** Visibility a host reports for a project, folded to the three answers every provider shares. */
export type GitVisibility = 'public' | 'private' | 'internal' | 'unknown'

/** One project an account can reach, as the page lists it. */
export interface GitProject {
  /** Host-side identity of the project (`owner/repo` for GitHub and Gitee, numeric id for GitLab). */
  readonly id: string
  /** The account that listed it. */
  readonly accountId: string
  /** Host family the project lives on. */
  readonly provider: GitProvider
  /** Namespaced path the host displays, e.g. `acme/widgets`. */
  readonly fullName: string
  /** The project's own name. */
  readonly name: string
  /** The project description, when the host has one. */
  readonly description?: string
  /** Visibility. */
  readonly visibility: GitVisibility
  /** Default branch name, when the host reports one. */
  readonly defaultBranch?: string
  /** Last activity, ISO 8601, when the host reports one. */
  readonly updatedAt?: string
  /** Browser URL. */
  readonly webUrl: string
  /** HTTPS clone URL, which is what the page copies. */
  readonly httpsUrl: string
  /** SSH clone URL, when the host reports one. */
  readonly sshUrl?: string
}

/** One page of an account's projects. */
export interface GitProjectPage {
  /** The account the page belongs to. */
  readonly accountId: string
  /** One-based page number, echoed back. */
  readonly page: number
  /** Whether the host says a further page exists. */
  readonly hasMore: boolean
  /** This page's rows, newest activity first. */
  readonly projects: readonly GitProject[]
}

/** The source families a scan reads. */
export const SCAN_SOURCES = ['credential-manager', 'git-credentials', 'gh-cli', 'environment', 'ssh'] as const

/** One scan source. */
export type ScanSourceId = (typeof SCAN_SOURCES)[number]

/** Whether one scan source exists on this machine, and whether it is supported here. */
export interface ScanSourceStatus {
  /** The source family. */
  readonly id: ScanSourceId
  /** Whether reading it could produce candidates on this machine. */
  readonly available: boolean
  /** Whether the source applies to this platform at all (`credential-manager` is Windows-only). */
  readonly supported: boolean
}

/** One reason a scan found something it did not turn into an account, or a caveat worth reporting. */
export const SCAN_NOTE_CODES = [
  'ssh-keys-found',
  'unknown-host',
  'unverified-credential',
  'tool-missing',
  'platform-unsupported',
  'provider-probe-failed',
] as const

/** One scan note's machine code; the page owns the copy. */
export type ScanNoteCode = (typeof SCAN_NOTE_CODES)[number]

/** One caveat or skipped finding's explanation. */
export interface ScanNote {
  /** Machine-readable reason. */
  readonly code: ScanNoteCode
  /** Additional data the copy names verbatim (a host, a file name, a count), when any. */
  readonly detail?: string
}

/** One SSH private key this machine offers for Git authentication. Never its contents. */
export interface GitSshKey {
  /** Absolute path of the private key file. */
  readonly path: string
  /** The file name, as the add dialog lists it. */
  readonly name: string
}

/** What one read of this machine's SSH keys found. */
export interface GitSshKeysResult {
  /** The private key files the add dialog can offer, deduplicated and ordered by name. */
  readonly keys: readonly GitSshKey[]
}

/** What a scan did with one candidate credential. */
export interface ScanCandidateOutcome {
  /** The account's host family when it could be determined. */
  readonly provider?: GitProvider
  /** Host the credential names. */
  readonly host: string
  /** Login when the host reported one, or the credential's stored username. */
  readonly login?: string
  /** Source family that found it. */
  readonly source: ScanSourceId
  /** How the candidate would authenticate, when it got that far. */
  readonly auth?: GitAuthMethod
  /** The outcome. `updated` means an existing account's token was replaced. */
  readonly outcome: 'added' | 'updated' | 'duplicate' | 'unverified' | 'unknown-host'
  /** Machine code naming the host's refusal, for an `unverified` outcome. */
  readonly errorCode?: GitAccountsErrorCode
}

/** What one scan settled, beside the refreshed account list. */
export interface ScanReport {
  /** Sources the scan could read, with availability. */
  readonly sources: readonly ScanSourceStatus[]
  /** How many stored credentials the scan tried. */
  readonly examined: number
  /** Accounts added by this scan. */
  readonly added: readonly GitAccountSummary[]
  /** Existing accounts whose stored token this scan replaced. */
  readonly updated: readonly GitAccountSummary[]
  /** Candidates that became no account, each with its reason. */
  readonly skipped: readonly ScanCandidateOutcome[]
  /** Caveats worth showing after a scan, e.g. SSH keys that cannot list projects. */
  readonly notes: readonly ScanNote[]
}

/** The page's whole first read: accounts, identity, and what a scan would read. */
export interface GitAccountsSnapshot {
  /** Connected accounts, oldest first. */
  readonly accounts: readonly GitAccountSummary[]
  /** The operator's global Git identity. */
  readonly identity: GitIdentity
  /** Source availability for the scan control. */
  readonly sources: readonly ScanSourceStatus[]
  /** Host platform, so the page can explain which sources apply. */
  readonly platform: string
}

/** One account the Host accepted, with whether it was new. */
export interface AddAccountResult {
  /** The account after verification and storage. */
  readonly account: GitAccountSummary
  /** False when an account for the same provider, host, and login already existed and its token was refreshed. */
  readonly created: boolean
}

/** One credential to verify without storing it. */
export interface VerifyAccountInput {
  /** Host family. */
  readonly provider: GitProvider
  /** Host that serves the account. */
  readonly host: string
  /** How the credential authenticates. */
  readonly auth?: GitAuthMethod
  /** The access token, for a token probe. */
  readonly token?: string
  /** The private key path, for an SSH probe. */
  readonly keyPath?: string
}

/** What one connection test reported, without storing anything. */
export interface VerifyAccountResult {
  /** The host family the credential belongs to (an SSH banner can correct a self-hosted guess). */
  readonly provider: GitProvider
  /** The method that was verified. */
  readonly auth: GitAuthMethod
  /** The login the host named. */
  readonly login: string
  /** Display name the host reports, when it reports one. */
  readonly name?: string
  /** Email the host reports, when it reports one. */
  readonly email?: string
  /** The account's profile page, when the host reports it. */
  readonly profileUrl?: string
  /** Token scopes, when the host reports them. */
  readonly scopes?: string
  /** The SSH endpoint that answered (`host:port`), when an SSH fallback port was used. */
  readonly endpoint?: string
}

/** A scan's result: the report plus the refreshed list, so one call updates the page. */
export interface ScanResult {
  /** What the scan did. */
  readonly report: ScanReport
  /** The complete account list after the scan. */
  readonly accounts: readonly GitAccountSummary[]
}

/** Machine-readable failure classes both halves agree on. */
export const GIT_ACCOUNTS_ERROR_CODES = [
  'invalid_input',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'network',
  'provider_unavailable',
  'credentials_unavailable',
  'account_not_found',
  'ssh_no_api',
  'git_missing',
  'git_failed',
  'scan_unsupported',
] as const

/** One failure class. */
export type GitAccountsErrorCode = (typeof GIT_ACCOUNTS_ERROR_CODES)[number]

/** The result of one page call: the value, or the Host's refusal text and code. */
export type GitRouteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly code?: GitAccountsErrorCode }

/**
 * The data face the page is injected with when it is registered.
 *
 * Every method resolves a route result rather than throwing: a refusal is shown
 * where the affected control sits, and a transport failure is caught by the api
 * client and reported the same way, so a component never owns an error state it
 * cannot explain.
 */
export interface GitAccountsInjected {
  /**
   * Read the whole page: accounts, identity, and scan-source availability.
   * @returns the snapshot, or the Host's refusal.
   */
  snapshot: () => Promise<GitRouteResult<GitAccountsSnapshot>>
  /**
   * Verify one credential and store it as an account.
   * @param input - provider, host, and either an access token or an SSH private key path.
   * @returns the accepted account, or the Host's refusal.
   */
  addAccount: (input: {
    readonly provider: GitProvider
    readonly host: string
    readonly auth?: GitAuthMethod
    readonly token?: string
    readonly keyPath?: string
  }) => Promise<GitRouteResult<AddAccountResult>>
  /**
   * Test one connection without storing anything.
   *
   * The add dialog's "Test connection" control calls this first, so an operator
   * can see whether a host answers before deciding to store the credential.
   * @param input - provider, host, and either an access token or an SSH key path.
   * @returns the login the host named, or the Host's refusal.
   */
  verifyAccount: (input: VerifyAccountInput) => Promise<GitRouteResult<VerifyAccountResult>>
  /**
   * Read the SSH private keys this machine offers, so the add dialog can list them.
   * @returns the key paths and names, or the Host's refusal.
   */
  sshKeys: () => Promise<GitRouteResult<GitSshKeysResult>>
  /**
   * Forget one account's stored token.
   * @param id - the account's credential-record id.
   * @returns a confirmation, or the Host's refusal.
   */
  removeAccount: (id: string) => Promise<GitRouteResult<{ readonly removed: true }>>
  /**
   * Scan this machine's existing authorizations and adopt what verifies.
   * @returns the report and the refreshed account list, or the Host's refusal.
   */
  scan: () => Promise<GitRouteResult<ScanResult>>
  /**
   * Read one page of one account's projects.
   * @param accountId - the account whose token lists them.
   * @param page - one-based page number.
   * @returns the page, or the Host's refusal.
   */
  projects: (accountId: string, page: number) => Promise<GitRouteResult<GitProjectPage>>
  /**
   * Write the global Git identity.
   * @param identity - the new name and email; an empty field clears that key.
   * @returns the identity as read back, or the Host's refusal.
   */
  saveIdentity: (identity: { name: string; email: string }) => Promise<GitRouteResult<{ readonly identity: GitIdentity }>>
}
