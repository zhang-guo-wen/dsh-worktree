/**
 * The Git-accounts capability, Host half: credentials, identity, projects, and
 * the adoption of authorizations this machine already holds.
 *
 * Accounts are stored as credential records through the Harness credential
 * seam, not in a file of this plugin's own: the seam owns where a secret is
 * written and how it is protected (the local provider writes `0600` and layers
 * environment overrides), and a record's payload is opaque to every other
 * plugin. Each account is one record under the `worktree` scope, whose payload
 * is this module's own JSON; {@link parseStoredAccount} validates it on every
 * read because the record crosses disk.
 *
 * Nothing here returns a token. The wire types carry account summaries,
 * projects, identity, and scan outcomes only, so a route, a component, or a
 * log line cannot expose a secret by accident.
 *
 * A provider request that the remote refuses becomes a {@link GitAccountsError}
 * with a code the page can explain; an HTTP failure's message is already
 * sanitized by the HTTP edge, which strips the query string a Gitee token rides
 * in.
 * @module @guowenzhang/dsh-worktree/git-accounts/accounts
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type {
  CredentialKey, CredentialProvider, CredentialRecord, GrantRecord,
} from '@deepseek-ai/dsh-credentials'
import { fetchProviderJson, GitProviderHttpError } from './http.ts'
import {
  readGitIdentity, writeGitIdentity, GitIdentityError,
} from './identity.ts'
import { knownProviderForHost, providerSpec, ProviderDataError, type AccountProfile } from './providers.ts'
import { scanAuthorizations, type RawScanCandidate, type RawScanResult, type ScanEnvironment } from './scan.ts'
import {
  listSshKeys as listSshKeyFiles, SshVerificationError, verifySshKey, type SshProbeResult,
} from './ssh.ts'
import {
  ACCOUNT_ORIGINS,
  GIT_AUTH_METHODS,
  GIT_PROVIDERS,
  type AccountOrigin,
  type AddAccountResult,
  type GitAccountSummary,
  type GitAccountsErrorCode,
  type GitAccountsSnapshot,
  type GitAuthMethod,
  type GitIdentity,
  type GitProjectPage,
  type GitProvider,
  type GitSshKeysResult,
  type ScanCandidateOutcome,
  type ScanReport,
  type ScanResult,
  type ScanSourceStatus,
  type VerifyAccountResult,
} from './types.ts'

/** Credential-record scope: the owning plugin's registered name. */
const ACCOUNT_SCOPE = 'worktree'

/** The credential-record id grammar, as the credential seam defines it. */
const ACCOUNT_ID_PATTERN = /^[a-z][a-z0-9-]*$/u

/** Version tag of the payload this module writes; a record with another tag is not interpreted. */
const PAYLOAD_VERSION = 1

/** Longest account token accepted; a form bound, not a protocol rule. */
const TOKEN_MAX_LENGTH = 1000

/** Shortest account token accepted; anything shorter cannot be a provider token. */
const TOKEN_MIN_LENGTH = 4

/** Whitespace never belongs inside a token that was pasted as one value. */
const TOKEN_WHITESPACE = /\s/u

/** Environment variables the scan reads as tokens; each belongs to the host its source implies. */
const ENVIRONMENT_TOKEN_VARIABLES = ['GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'GITLAB_PRIVATE_TOKEN', 'GITEE_TOKEN', 'GITEE_ACCESS_TOKEN'] as const

/** The Windows credential manager is the one platform-specific source. */
const WINDOWS_PLATFORM = 'win32'

/**
 * One stored account payload, as this module writes it into a grant record.
 *
 * Exported for the Host's own tests, which drive the service through an
 * in-memory credential provider; nothing on the wire carries this type.
 */
export interface StoredAccount {
  /** Payload version, so a future reader can tell this spelling apart. */
  readonly version: typeof PAYLOAD_VERSION
  /** Host family. */
  readonly provider: GitProvider
  /** Host that serves the account. */
  readonly host: string
  /** How this account authenticates. A record written before SSH existed has no field and is a token account. */
  readonly auth: GitAuthMethod
  /** The access token, for a token account. Never leaves the Host. */
  readonly token?: string
  /** The private key path, for an SSH account. Never its contents. */
  readonly keyPath?: string
  /** The host's login for the account. */
  readonly login: string
  /** Display name the host reports. */
  readonly name?: string
  /** Email the host reports. */
  readonly email?: string
  /** Profile page on the host. */
  readonly profileUrl?: string
  /** Token scopes the host reported. */
  readonly scopes?: string
  /** When the account was added or last refreshed, ISO 8601. */
  readonly addedAt: string
  /** Whether the host confirmed the credential; false only for an SSH account saved while the host was unreachable. */
  readonly verified: boolean
  /** How the credential arrived. */
  readonly origin: AccountOrigin
}

/** One stored record with the key segment that addresses it. */
interface StoredEntry {
  /** The record's id segment. */
  readonly id: string
  /** The parsed payload. */
  readonly account: StoredAccount
}

/** One scan candidate after the credential was verified. */
interface VerifiedCandidate {
  /** The account's host family. */
  readonly provider: GitProvider
  /** The host that accepted the credential. */
  readonly host: string
  /** How the candidate authenticates. */
  readonly auth: GitAuthMethod
  /** The secret material to persist: the token, or the private key path. */
  readonly secret: string
  /** What the host reported about the account. */
  readonly profile: AccountProfile
}

/** One credential after a successful verification. */
interface VerifiedCredential {
  /** The host family the credential belongs to. */
  readonly provider: GitProvider
  /** What the host reported about the account. */
  readonly profile: AccountProfile
  /** The token or private key path to persist. */
  readonly secret: string
  /** The SSH endpoint that answered, when a fallback port was used. */
  readonly endpoint?: string
}

/** What one scan candidate settled as, before it is turned into a report row. */
type CandidateVerdict =
  | { readonly kind: 'resolved'; readonly verified: VerifiedCandidate }
  | { readonly kind: 'unverified'; readonly errorCode: GitAccountsErrorCode }

/**
 * The credential-provider methods this capability needs.
 *
 * Narrower than the whole provider on purpose: an account is a record the
 * capability owns, and it never resolves a configuration reference or stores a
 * keyed value. A test drives these four methods with an in-memory map.
 */
export type AccountCredentialStore = Pick<
  CredentialProvider,
  'listRecords' | 'readRecord' | 'modifyRecord' | 'deleteRecord'
>

/** The transport dependencies a test replaces; production leaves both unset. */
export interface GitAccountsServiceOptions {
  /** Reads the live credential provider from the Host context; undefined when the deployment lacks one. */
  readonly credentials: () => AccountCredentialStore | undefined
  /** The scan implementation; defaults to {@link scanAuthorizations}. */
  readonly scan?: (environment: ScanEnvironment) => Promise<RawScanResult>
  /** SSH verification; defaults to {@link verifySshKey}. Tests replace it so no case opens an SSH connection. */
  readonly verifySsh?: (request: {
    readonly provider: GitProvider
    readonly host: string
    readonly keyPath: string
  }) => Promise<SshProbeResult>
  /** Fixed environment for a test; production resolves the process's own at call time. */
  readonly environment?: ScanEnvironment
  /** Directory Git runs in, and the extra environment a test points at a scratch global config. */
  readonly git?: { readonly cwd?: string; readonly environment?: Readonly<Record<string, string | undefined>> }
  /** Receives a diagnostic for a record this module cannot interpret; never carries a token. */
  readonly warn?: (message: string) => void
}

/** One capability failure with the code and HTTP status the route reports. */
export class GitAccountsError extends Error {
  /**
   * @param code - machine-readable failure class.
   * @param message - actionable text for the page.
   */
  constructor(
    readonly code: GitAccountsErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GitAccountsError'
  }
}

/**
 * The HTTP status a route answers for one failure class.
 * @param code - the failure class.
 * @returns the status to answer with.
 */
export function statusForAccountsError(code: GitAccountsErrorCode): number {
  switch (code) {
    case 'invalid_input':
    case 'ssh_no_api':
    case 'scan_unsupported':
      return 400
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'not_found':
    case 'account_not_found':
      return 404
    case 'rate_limited':
      return 429
    case 'credentials_unavailable':
      return 503
    case 'network':
    case 'provider_unavailable':
      return 502
    case 'git_missing':
    case 'git_failed':
      return 500
  }
}

/**
 * The capability over one Host deployment.
 *
 * Every read of the credential provider and of the process environment happens
 * per call, so a replaced provider or a changed environment reaches the next
 * operation without rebuilding this object.
 */
export class GitAccountsService {
  /**
   * @param options - the credential provider accessor, the scan implementation, and test seams.
   */
  constructor(private readonly options: GitAccountsServiceOptions) {}

  /**
   * Read the page's whole first state: accounts, identity, and what a scan would read.
   * @returns the snapshot.
   * @throws {GitAccountsError} when the deployment has no credential provider.
   */
  async snapshot(): Promise<GitAccountsSnapshot> {
    const accounts = (await this.listStored()).map(entry => summaryOf(entry))
    const identity = await readGitIdentity(this.gitCwd(), this.options.git?.environment)
    return {
      accounts,
      identity,
      sources: this.describeSources(),
      platform: this.platform(),
    }
  }

  /**
   * Verify one credential and store it as an account.
   *
   * A token account is verified through the host's REST API; an SSH account is
   * verified by one non-interactive `ssh -T`, and its private key stays where it
   * is — only the path is stored. `auth` defaults to `token`, and a request that
   * names `keyPath` without `auth` is an SSH account.
   *
   * An SSH account is still stored when the probe fails because the host is
   * **unreachable**: the key path is what Git needs later, and a network outage
   * is not evidence the key is wrong. Such a row is marked unverified and its
   * login is the key's file name until a later verified add replaces it. A
   * refused key (`unauthorized`), unusable input, or a refused token still fails,
   * so a credential the host actively rejects is never stored as valid.
   * @param input - host family, host, and either a token or a private key path; `origin` is set by the caller that knows the provenance.
   * @returns the accepted account and whether it is new.
   * @throws {GitAccountsError} when the input is invalid or the host refuses the credential.
   */
  async add(input: {
    readonly provider: string
    readonly host: string
    readonly auth?: string
    readonly token?: string
    readonly keyPath?: string
    readonly origin?: AccountOrigin
  }): Promise<AddAccountResult> {
    const credentials = this.requireCredentials()
    const provider = parseProvider(input.provider)
    const host = parseHost(provider, input.host)
    const auth = parseAuthMethod(input)
    const secret = auth === 'ssh' ? parseKeyPath(input.keyPath) : parseToken(input.token)
    let verified: VerifiedCredential
    let isVerified = true
    try {
      verified = await this.verifyCredential(provider, host, auth, secret)
    } catch (error: unknown) {
      if (auth !== 'ssh' || !(error instanceof GitAccountsError) || error.code !== 'network') throw error
      // The key itself may be perfectly good; the host just cannot be reached
      // from this network right now. Store it for Git to use when it can.
      verified = { provider, profile: { login: loginForUnverifiedKey(secret) }, secret }
      isVerified = false
    }
    const accountProvider = verified.provider
    const existing = (await this.listStored()).find(entry => sameCredential(entry.account, {
      provider: accountProvider,
      host,
      auth,
      login: verified.profile.login,
      secret: verified.secret,
    }))
    // A failed reconnect must not downgrade an account the host already
    // confirmed; keep the verified row and answer it unchanged.
    if (!isVerified && existing !== undefined && existing.account.verified !== false) {
      return { account: summaryOf(existing), created: false }
    }
    const id = existing?.id ?? createAccountId(accountProvider)
    const account: StoredAccount = {
      version: PAYLOAD_VERSION,
      provider: accountProvider,
      host,
      auth,
      ...auth === 'ssh' ? { keyPath: verified.secret } : { token: verified.secret },
      login: verified.profile.login,
      ...optional('name', verified.profile.name),
      ...optional('email', verified.profile.email),
      ...optional('profileUrl', verified.profile.profileUrl),
      ...optional('scopes', verified.profile.scopes),
      addedAt: new Date().toISOString(),
      verified: isVerified,
      origin: input.origin ?? 'manual',
    }
    await this.writeStored(credentials, id, account)
    return { account: summaryOf({ id, account }), created: existing === undefined }
  }

  /**
   * Test one credential against its host without storing anything.
   * @param input - host family, host, and either a token or a private key path.
   * @returns the login and profile facts the host reported.
   * @throws {GitAccountsError} when the input is invalid or the host refuses the credential.
   */
  async verifyAccount(input: {
    readonly provider: string
    readonly host: string
    readonly auth?: string
    readonly token?: string
    readonly keyPath?: string
  }): Promise<VerifyAccountResult> {
    const provider = parseProvider(input.provider)
    const host = parseHost(provider, input.host)
    const auth = parseAuthMethod(input)
    const secret = auth === 'ssh' ? parseKeyPath(input.keyPath) : parseToken(input.token)
    const verified = await this.verifyCredential(provider, host, auth, secret)
    return {
      provider: verified.provider,
      auth,
      login: verified.profile.login,
      ...optional('name', verified.profile.name),
      ...optional('email', verified.profile.email),
      ...optional('profileUrl', verified.profile.profileUrl),
      ...optional('scopes', verified.profile.scopes),
      ...optional('endpoint', verified.endpoint),
    }
  }

  /**
   * Read the SSH private keys this machine offers, for the add dialog's picker.
   * @returns the key paths and names; an absent `~/.ssh` answers an empty list.
   * @throws {GitAccountsError} when the deployment has no credential provider.
   */
  async listSshKeys(): Promise<GitSshKeysResult> {
    // The credential provider is required only so this call fails the same way
    // as the rest of the page on a deployment that cannot store accounts.
    this.requireCredentials()
    return { keys: await listSshKeyFiles(this.homeDirectory()) }
  }

  /**
   * Forget one account's stored token.
   * @param id - the account's record id.
   * @returns a confirmation.
   * @throws {GitAccountsError} when no such account is stored.
   */
  async remove(id: string): Promise<{ readonly removed: true }> {
    const credentials = this.requireCredentials()
    const key = accountKey(id)
    if (await readStoredPayload(credentials, key) === undefined) {
      throw new GitAccountsError('account_not_found', `no Git account ${JSON.stringify(id)} is stored`)
    }
    await credentials.deleteRecord(key)
    return { removed: true }
  }

  /**
   * Read one page of one account's projects, newest activity first.
   *
   * Only a token account can list projects: an SSH key authorizes Git transport,
   * and the provider APIs this capability reads are not reachable with it. The
   * refusal names the remedy (add a token account) rather than failing silently.
   * @param accountId - the account whose token lists them.
   * @param page - one-based page number.
   * @returns that page.
   * @throws {GitAccountsError} when the account is unknown, is SSH-only, the input is invalid, or the host refuses.
   */
  async projects(accountId: string, page: number): Promise<GitProjectPage> {
    const credentials = this.requireCredentials()
    if (!Number.isInteger(page) || page < 1 || page > 100) {
      throw new GitAccountsError('invalid_input', 'page must be an integer between 1 and 100')
    }
    const entry = await this.readStored(credentials, accountId)
    if (entry.account.auth === 'ssh' || entry.account.token === undefined) {
      throw new GitAccountsError('ssh_no_api',
        'this account authenticates over SSH, which cannot list projects through the host API; add an access-token account to browse projects')
    }
    const spec = providerSpec(entry.account.provider)
    try {
      const response = await fetchProviderJson(spec.projectsRequest(entry.account.host, entry.account.token, page))
      const listed = spec.parseProjects(response.body, response.headers)
      return {
        accountId,
        page,
        hasMore: listed.hasMore,
        projects: listed.projects.map(project => ({
          ...project,
          accountId,
          provider: entry.account.provider,
        })),
      }
    } catch (error: unknown) {
      throw toAccountsError(error)
    }
  }

  /**
   * Scan this machine's existing authorizations and adopt everything that verifies.
   *
   * Every candidate is verified against its host before it becomes an account: a
   * stored password that is not a token, an expired token, an SSH key the host
   * refuses, and a credential for a host that no longer answers all stay out of
   * the list and are reported as skipped instead. An unknown host is probed with
   * each provider's API path, because a self-hosted instance's domain need not
   * carry its product's name.
   * @returns the report and the account list after adoption.
   * @throws {GitAccountsError} when the deployment has no credential provider.
   */
  async scan(): Promise<ScanResult> {
    const credentials = this.requireCredentials()
    const environment = this.scanEnvironment()
    const scan = this.options.scan ?? scanAuthorizations
    const raw = await scan(environment)
    const added: GitAccountSummary[] = []
    const updated: GitAccountSummary[] = []
    const skipped: ScanCandidateOutcome[] = []
    let existing = await this.listStored()
    for (const candidate of raw.candidates) {
      const verdict = await this.verifyCandidate(candidate)
      if (verdict.kind === 'unverified') {
        skipped.push({
          ...candidate.provider === undefined ? {} : { provider: candidate.provider },
          host: candidate.host,
          ...candidate.login === undefined ? {} : { login: candidate.login },
          ...candidate.auth === undefined ? {} : { auth: candidate.auth },
          source: candidate.source,
          outcome: 'unverified',
          errorCode: verdict.errorCode,
        })
        continue
      }
      const verified = verdict.verified
      const match = existing.find(entry => sameCredential(entry.account, {
        provider: verified.provider,
        host: verified.host,
        auth: verified.auth,
        login: verified.profile.login,
        secret: verified.secret,
      }))
      const id = match?.id ?? createAccountId(verified.provider)
      const account: StoredAccount = {
        version: PAYLOAD_VERSION,
        provider: verified.provider,
        host: verified.host,
        auth: verified.auth,
        ...verified.auth === 'ssh' ? { keyPath: verified.secret } : { token: verified.secret },
        login: verified.profile.login,
        ...optional('name', verified.profile.name),
        ...optional('email', verified.profile.email),
        ...optional('profileUrl', verified.profile.profileUrl),
        ...optional('scopes', verified.profile.scopes),
        addedAt: new Date().toISOString(),
        verified: true,
        origin: originForSource(candidate.source),
      }
      const duplicate = match !== undefined && (
        verified.auth === 'ssh'
          ? match.account.keyPath === verified.secret
          : match.account.token === verified.secret
      )
      if (!duplicate) await this.writeStored(credentials, id, account)
      const entry: StoredEntry = { id, account }
      if (duplicate) {
        skipped.push({
          provider: verified.provider,
          host: verified.host,
          login: verified.profile.login,
          auth: verified.auth,
          source: candidate.source,
          outcome: 'duplicate',
        })
        continue
      }
      if (match === undefined) {
        added.push(summaryOf(entry))
        existing = [...existing, entry]
      } else {
        updated.push(summaryOf(entry))
        existing = existing.map(candidateEntry => candidateEntry.id === id ? entry : candidateEntry)
      }
    }
    const report: ScanReport = {
      sources: raw.sources,
      examined: raw.candidates.length,
      added,
      updated,
      skipped,
      notes: raw.notes,
    }
    return { report, accounts: existing.map(entry => summaryOf(entry)) }
  }

  /**
   * Write the global Git identity.
   * @param input - the submitted name and email; an empty field clears that key.
   * @returns the identity as Git reports it after the write.
   * @throws {GitAccountsError} when the submission is invalid or Git cannot write.
   */
  async saveIdentity(input: { readonly name: string; readonly email: string }): Promise<{ readonly identity: GitIdentity }> {
    try {
      return { identity: await writeGitIdentity(this.gitCwd(), input, this.options.git?.environment) }
    } catch (error: unknown) {
      if (error instanceof GitIdentityError) throw new GitAccountsError(error.code, error.message)
      throw error
    }
  }

  /** Read every stored account, oldest first. @returns the entries. */
  private async listStored(): Promise<StoredEntry[]> {
    const credentials = this.requireCredentials()
    const records = await credentials.listRecords()
    const entries: StoredEntry[] = []
    for (const record of records) {
      const [scope, id] = splitKey(record.key)
      if (scope !== ACCOUNT_SCOPE || id === undefined || !ACCOUNT_ID_PATTERN.test(id)) continue
      const stored = await readStoredPayload(credentials, record.key)
      if (stored === undefined) {
        this.options.warn?.(`dsh-worktree: ignored an unreadable Git account record ${JSON.stringify(record.key)}`)
        continue
      }
      entries.push({ id, account: stored })
    }
    return entries.sort((left, right) =>
      left.account.addedAt === right.account.addedAt
        ? left.id.localeCompare(right.id)
        : left.account.addedAt.localeCompare(right.account.addedAt))
  }

  /**
   * Read one account by its record id.
   * @param credentials - the live provider.
   * @param id - the record id.
   * @returns the parsed payload.
   * @throws {GitAccountsError} when no readable record is stored under that id.
   */
  private async readStored(credentials: AccountCredentialStore, id: string): Promise<StoredEntry> {
    const key = accountKey(id)
    const account = await readStoredPayload(credentials, key)
    if (account === undefined) {
      throw new GitAccountsError('account_not_found', `no Git account ${JSON.stringify(id)} is stored`)
    }
    return { id, account }
  }

  /**
   * Write one account payload as a grant record.
   * @param credentials - the live provider.
   * @param id - the record id.
   * @param account - the payload.
   */
  private async writeStored(credentials: AccountCredentialStore, id: string, account: StoredAccount): Promise<void> {
    const record: GrantRecord = { kind: 'grant', payload: account }
    await credentials.modifyRecord(accountKey(id), () => Promise.resolve(record))
  }

  /**
   * Verify one token against its host, mapping the host's failure into this capability's code.
   * @param provider - host family.
   * @param host - normalized host.
   * @param token - the token to verify.
   * @returns what the host reports about the account.
   * @throws {GitAccountsError} when the host refuses the token or the answer is unusable.
   */
  private async verify(provider: GitProvider, host: string, token: string): Promise<AccountProfile> {
    const spec = providerSpec(provider)
    try {
      const response = await fetchProviderJson(spec.userRequest(host, token))
      return spec.parseProfile(response.body, response.headers)
    } catch (error: unknown) {
      throw toAccountsError(error)
    }
  }

  /**
   * Verify one private key with a non-interactive SSH probe.
   *
   * The banner also names the host family, so a self-hosted domain that the
   * inference could not place can still be recorded under the platform it really
   * serves; the caller's provider is the fallback when the banner's wording is
   * not recognizable.
   * @param provider - host family the caller believes, used for the probe's messages.
   * @param host - normalized host.
   * @param keyPath - private key path; its contents are never read.
   * @returns the verified provider, profile, path to store, and endpoint that answered.
   * @throws {GitAccountsError} when the key is unusable, refused, or the host is unreachable.
   */
  private async verifySshCredential(
    provider: GitProvider,
    host: string,
    keyPath: string,
  ): Promise<VerifiedCredential> {
    const verify = this.options.verifySsh ?? verifySshKey
    try {
      const result: SshProbeResult = await verify({ provider, host, keyPath })
      return {
        provider: result.provider ?? provider,
        profile: result.profile,
        secret: keyPath,
        ...result.endpoint === undefined ? {} : { endpoint: result.endpoint },
      }
    } catch (error: unknown) {
      if (error instanceof SshVerificationError) throw new GitAccountsError(error.code, error.message)
      throw error
    }
  }

  /**
   * Verify one credential by its method.
   * @param provider - host family the caller believes.
   * @param host - normalized host.
   * @param auth - token or SSH.
   * @param secret - the token, or the private key path.
   * @returns the verified credential.
   * @throws {GitAccountsError} when the host refuses the credential or cannot be reached.
   */
  private async verifyCredential(
    provider: GitProvider,
    host: string,
    auth: GitAuthMethod,
    secret: string,
  ): Promise<VerifiedCredential> {
    if (auth === 'ssh') return await this.verifySshCredential(provider, host, secret)
    return { provider, profile: await this.verify(provider, host, secret), secret }
  }

  /**
   * Decide one scan candidate: which provider accepts its credential, or why none did.
   *
   * A token candidate whose source already names its provider — an environment
   * variable's host is fixed, and the credential manager's host went through the
   * same inference — is verified only against that provider: probing the others
   * would replace the host's real refusal (an expired token is `unauthorized`)
   * with a wrong URL's `not_found`. A token host the scan could not place is
   * probed with every provider, in a fixed order that starts with GitLab because
   * self-hosted instances are the common unknown-host case in this deployment.
   *
   * An SSH candidate is one probe against the host itself; the banner names the
   * host family, so no provider probing is needed (and probing several REST
   * paths would not verify a key anyway).
   * @param candidate - one scanned credential.
   * @returns the verified account or the failure class.
   */
  private async verifyCandidate(candidate: RawScanCandidate): Promise<CandidateVerdict> {
    if (candidate.auth === 'ssh') {
      if (candidate.keyPath === undefined || candidate.keyPath === '') {
        return { kind: 'unverified', errorCode: 'invalid_input' }
      }
      const guessed = candidate.provider ?? knownProviderForHost(candidate.host)
      try {
        const host = providerSpec(guessed ?? 'gitlab').normalizeHost(candidate.host)
        const verified = await this.verifySshCredential(guessed ?? 'gitlab', host, candidate.keyPath)
        return {
          kind: 'resolved',
          verified: { provider: verified.provider, host, auth: 'ssh', secret: verified.secret, profile: verified.profile },
        }
      } catch (error: unknown) {
        return { kind: 'unverified', errorCode: error instanceof GitAccountsError ? error.code : 'provider_unavailable' }
      }
    }
    if (candidate.token === undefined || candidate.token === '') {
      return { kind: 'unverified', errorCode: 'invalid_input' }
    }
    if (candidate.provider !== undefined) {
      try {
        const host = providerSpec(candidate.provider).normalizeHost(candidate.host)
        const profile = await this.verify(candidate.provider, host, candidate.token)
        return { kind: 'resolved', verified: { provider: candidate.provider, host, auth: 'token', secret: candidate.token, profile } }
      } catch (error: unknown) {
        return { kind: 'unverified', errorCode: error instanceof GitAccountsError ? error.code : 'provider_unavailable' }
      }
    }
    const guessed = knownProviderForHost(candidate.host)
    const order: GitProvider[] = guessed === undefined
      ? ['gitlab', 'github', 'gitee']
      : [guessed, ...GIT_PROVIDERS.filter(provider => provider !== guessed)]
    let lastCode: GitAccountsErrorCode = 'provider_unavailable'
    for (const provider of order) {
      try {
        const host = providerSpec(provider).normalizeHost(candidate.host)
        const profile = await this.verify(provider, host, candidate.token)
        return { kind: 'resolved', verified: { provider, host, auth: 'token', secret: candidate.token, profile } }
      } catch (error: unknown) {
        if (error instanceof GitAccountsError) {
          lastCode = error.code
          // A network failure is the host being unreachable, not this provider
          // being the wrong guess: trying every other provider would repeat it.
          if (error.code === 'network') break
          continue
        }
        lastCode = 'provider_unavailable'
      }
    }
    return { kind: 'unverified', errorCode: lastCode }
  }

  /**
   * The scan sources a snapshot can report without reading any of them.
   * @returns the fixed source list with availability for this machine.
   */
  private describeSources(): ScanSourceStatus[] {
    const platform = this.platform()
    const environment = this.processEnvironment()
    const ghAvailable = findExecutable('gh') !== undefined
    const gitCredentials = existsSync(join(this.homeDirectory(), '.git-credentials'))
    const tokenInEnvironment = ENVIRONMENT_TOKEN_VARIABLES.some(name => (environment[name] ?? '').trim() !== '')
    const sshDirectory = existsSync(join(this.homeDirectory(), '.ssh'))
    return [
      { id: 'credential-manager', supported: platform === WINDOWS_PLATFORM, available: platform === WINDOWS_PLATFORM },
      { id: 'git-credentials', supported: true, available: gitCredentials },
      { id: 'gh-cli', supported: true, available: ghAvailable },
      { id: 'environment', supported: true, available: tokenInEnvironment },
      { id: 'ssh', supported: true, available: sshDirectory },
    ]
  }

  /** @returns the credential provider or a failure naming the missing deployment service. */
  private requireCredentials(): AccountCredentialStore {
    const credentials = this.options.credentials()
    if (credentials === undefined) {
      throw new GitAccountsError('credentials_unavailable',
        'this deployment has no credential service, so Git accounts cannot be stored; add @deepseek-ai/dsh-credentials-local to the profile')
    }
    return credentials
  }

  /** @returns the environment a scan reads. */
  private scanEnvironment(): ScanEnvironment {
    return this.options.environment ?? {
      platform: process.platform,
      homeDirectory: homedir(),
      environment: process.env,
    }
  }

  /** @returns the host platform a snapshot reports. */
  private platform(): string {
    return this.options.environment?.platform ?? process.platform
  }

  /** @returns the home directory whose per-user sources are described. */
  private homeDirectory(): string {
    return this.options.environment?.homeDirectory ?? homedir()
  }

  /** @returns the process environment a snapshot describes. */
  private processEnvironment(): Readonly<Record<string, string | undefined>> {
    return this.options.environment?.environment ?? process.env
  }

  /** @returns the directory Git runs in. */
  private gitCwd(): string {
    return this.options.git?.cwd ?? process.cwd()
  }
}

/**
 * Read and validate one stored payload.
 * @param credentials - the live provider.
 * @param key - the record's full key.
 * @returns the payload, or undefined when the record holds something this reader does not interpret.
 */
async function readStoredPayload(credentials: AccountCredentialStore, key: CredentialKey): Promise<StoredAccount | undefined> {
  let record: CredentialRecord | undefined
  try {
    record = await credentials.readRecord(key)
  } catch {
    // A record the provider cannot read is not an account this deployment can
    // serve; the caller reports it as unknown rather than failing the page.
    return undefined
  }
  if (record === undefined || record.kind !== 'grant') return undefined
  return parseStoredAccount(record.payload)
}

/**
 * Validate one stored payload across the file boundary.
 * @param payload - the record's opaque payload.
 * @returns the payload as this module wrote it, or undefined when it is not one.
 */
export function parseStoredAccount(payload: unknown): StoredAccount | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const value = payload as Record<string, unknown>
  if (value.version !== PAYLOAD_VERSION) return undefined
  if (typeof value.provider !== 'string' || !GIT_PROVIDERS.includes(value.provider as GitProvider)) return undefined
  if (typeof value.host !== 'string' || value.host === '') return undefined
  // A record written before SSH accounts existed carries no `auth`; it is a
  // token account, which is the only kind that version could write.
  const auth: GitAuthMethod = value.auth === 'ssh' ? 'ssh' : 'token'
  const token = value.token
  const keyPath = value.keyPath
  if (auth === 'token' && (typeof token !== 'string' || token === '')) return undefined
  if (auth === 'ssh' && (typeof keyPath !== 'string' || keyPath === '')) return undefined
  if (typeof value.login !== 'string' || value.login === '') return undefined
  if (typeof value.addedAt !== 'string' || value.addedAt === '') return undefined
  if (typeof value.origin !== 'string' || !ACCOUNT_ORIGINS.includes(value.origin as AccountOrigin)) return undefined
  return {
    version: PAYLOAD_VERSION,
    provider: value.provider as GitProvider,
    host: value.host,
    auth,
    ...auth === 'ssh' ? { keyPath: keyPath as string } : { token: token as string },
    login: value.login,
    ...optional('name', stringOrUndefined(value.name)),
    ...optional('email', stringOrUndefined(value.email)),
    ...optional('profileUrl', stringOrUndefined(value.profileUrl)),
    ...optional('scopes', stringOrUndefined(value.scopes)),
    addedAt: value.addedAt,
    // A record written before offline SSH saves existed carries no field; every
    // such record was verified before it was written.
    verified: value.verified !== false,
    origin: value.origin as AccountOrigin,
  }
}

/**
 * Build the wire summary of one stored account.
 * @param entry - the stored name-origin payload with its id.
 * @returns the summary the page renders.
 */
function summaryOf(entry: StoredEntry): GitAccountSummary {
  return {
    id: entry.id,
    provider: entry.account.provider,
    host: entry.account.host,
    login: entry.account.login,
    auth: entry.account.auth,
    verified: entry.account.verified,
    ...optional('name', entry.account.name),
    ...optional('email', entry.account.email),
    ...optional('profileUrl', entry.account.profileUrl),
    ...optional('scopes', entry.account.scopes),
    addedAt: entry.account.addedAt,
    origin: entry.account.origin,
  }
}

/**
 * Whether a stored account is the same credential a host now reports.
 *
 * A token account is identified by its login (the host decides who the token
 * is); an SSH account is identified by its key path, because a saved-while-
 * unreachable row's login is only the key's file name until a probe succeeds.
 * @param stored - the stored payload.
 * @param credential - the provider, host, method, login, and secret to match.
 * @returns true when provider, host, method, and the method's identity field agree.
 */
function sameCredential(stored: StoredAccount, credential: {
  readonly provider: GitProvider
  readonly host: string
  readonly auth: GitAuthMethod
  readonly login: string
  readonly secret: string
}): boolean {
  if (stored.auth !== credential.auth
    || stored.provider !== credential.provider
    || stored.host.toLowerCase() !== credential.host.toLowerCase()) return false
  if (stored.auth === 'ssh') return stored.keyPath === credential.secret
  return stored.login.toLowerCase() === credential.login.toLowerCase()
}

/**
 * Derive the placeholder login of an SSH account saved while the host was
 * unreachable. The file name is the only stable identity on hand; a later
 * verified add replaces it with the login the host names.
 * @param keyPath - the private key path.
 * @returns the key's file name, or `ssh` when the path has no name.
 */
function loginForUnverifiedKey(keyPath: string): string {
  const name = keyPath.replaceAll('\\', '/').split('/').pop() ?? ''
  return name === '' ? 'ssh' : name
}

/**
 * Validate the provider named by a request.
 * @param value - the request's provider string.
 * @returns the provider.
 * @throws {GitAccountsError} when the value names no supported host family.
 */
function parseProvider(value: string): GitProvider {
  if (!GIT_PROVIDERS.includes(value as GitProvider)) {
    throw new GitAccountsError('invalid_input', `provider must be one of ${GIT_PROVIDERS.join(', ')}`)
  }
  return value as GitProvider
}

/**
 * Normalize the host named by a request.
 * @param provider - the host family.
 * @param value - the request's host string.
 * @returns the host as the provider API names it.
 * @throws {GitAccountsError} when the host is not a host name.
 */
function parseHost(provider: GitProvider, value: string): string {
  try {
    return providerSpec(provider).normalizeHost(value)
  } catch (error: unknown) {
    if (error instanceof ProviderDataError) throw new GitAccountsError('invalid_input', error.message)
    throw error
  }
}

/**
 * Validate a pasted token.
 * @param value - the request's token.
 * @returns the token without surrounding whitespace.
 * @throws {GitAccountsError} when the value cannot be a provider token.
 */
function parseToken(value: string | undefined): string {
  if (value === undefined) throw new GitAccountsError('invalid_input', 'an access token is required for a token account')
  const token = value.trim()
  if (token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH || TOKEN_WHITESPACE.test(token)) {
    throw new GitAccountsError('invalid_input', 'token must be one pasted value with no whitespace inside')
  }
  return token
}

/**
 * Decide how one add request authenticates.
 *
 * An explicit `auth` wins; without it, a request that carries a key path is an
 * SSH account and everything else is a token account (the form's original and
 * still the common case).
 * @param input - the add request.
 * @returns the authentication method.
 * @throws {GitAccountsError} when the request names a method this capability does not speak.
 */
function parseAuthMethod(input: { readonly auth?: string; readonly keyPath?: string; readonly token?: string }): GitAuthMethod {
  if (input.auth !== undefined) {
    if (!GIT_AUTH_METHODS.includes(input.auth as GitAuthMethod)) {
      throw new GitAccountsError('invalid_input', `auth must be one of ${GIT_AUTH_METHODS.join(', ')}`)
    }
    return input.auth as GitAuthMethod
  }
  return input.keyPath !== undefined && input.token === undefined ? 'ssh' : 'token'
}

/**
 * Validate the private key path of an SSH add request.
 *
 * The path is not read here — the SSH probe resolves it — but a blank value is
 * refused before any probe starts.
 * @param value - the request's key path.
 * @returns the path, trimmed.
 * @throws {GitAccountsError} when no key path was supplied.
 */
function parseKeyPath(value: string | undefined): string {
  const keyPath = value?.trim() ?? ''
  if (keyPath === '') throw new GitAccountsError('invalid_input', 'an SSH private key path is required for an SSH account')
  return keyPath
}

/**
 * Map one scan source onto the account-origin vocabulary.
 *
 * The two vocabularies differ by one word: a scan calls the key ring `ssh`, while
 * a stored account records that its credential came from an `ssh-key`.
 * @param source - the scan source that found the candidate.
 * @returns the origin to store.
 */
function originForSource(source: ScanCandidateOutcome['source']): AccountOrigin {
  return source === 'ssh' ? 'ssh-key' : source
}

/**
 * Build one credential key for an account id.
 * @param id - the account's record id.
 * @returns the branded key the credential seam accepts.
 * @throws {GitAccountsError} when the id is outside the seam's key grammar.
 */
function accountKey(id: string): CredentialKey {
  if (!ACCOUNT_ID_PATTERN.test(id)) throw new GitAccountsError('account_not_found', `no Git account ${JSON.stringify(id)} is stored`)
  // The seam brands its keys; this string is spelled inside its documented
  // grammar (`<scope>/<id>`, both lowercase hyphenated identifiers), which the
  // pattern above enforces before the brand is applied.
  return `${ACCOUNT_SCOPE}/${id}` as CredentialKey
}

/**
 * Split a credential key back into scope and id.
 * @param key - the stored key.
 * @returns the scope and the id segment, when the key has exactly two segments.
 */
function splitKey(key: string): [string, string | undefined] {
  const separator = key.indexOf('/')
  if (separator < 0) return [key, undefined]
  return [key.slice(0, separator), key.slice(separator + 1)]
}

/**
 * Generate one account record id.
 * @param provider - the host family the id starts with, so a stored key is recognizable at a glance.
 * @returns the id.
 */
function createAccountId(provider: GitProvider): string {
  return `${provider}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

/**
 * Map an HTTP or parser failure into this capability's code.
 * @param error - the failure a provider call produced.
 * @returns the capability failure.
 */
function toAccountsError(error: unknown): GitAccountsError {
  if (error instanceof GitProviderHttpError) {
    const code: GitAccountsErrorCode = error.code === 'bad_response' ? 'provider_unavailable' : error.code
    return new GitAccountsError(code, error.message)
  }
  if (error instanceof ProviderDataError) return new GitAccountsError('provider_unavailable', error.message)
  return new GitAccountsError('network', error instanceof Error ? error.message : String(error))
}

/**
 * Keep an optional field out of an object when it has no value, so a stored
 * payload does not carry explicit `undefined`s that a JSON writer drops and a
 * strict reader then reports as missing.
 * @param key - the field name.
 * @param value - the value, or undefined.
 * @returns an object carrying the field only when it exists.
 */
function optional<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { readonly [P in K]?: V }
}

/**
 * Read a payload field that must be a non-empty string when present.
 * @param value - the raw field.
 * @returns the string, or undefined when it is absent or not usable.
 */
function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Find one executable on PATH.
 *
 * A snapshot describes the `gh` source without spawning it; this reachability
 * check only ever tests file existence. A false negative simply leaves the
 * source unmarked, and a scan still reads it.
 * @param name - the executable name.
 * @returns its path when one exists on PATH.
 */
function findExecutable(name: string): string | undefined {
  const pathValue = process.env.PATH ?? ''
  const candidates = process.platform === WINDOWS_PLATFORM
    ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`, `${name}.COM`]
    : [name]
  for (const directory of pathValue.split(delimiter)) {
    if (directory === '') continue
    for (const candidate of candidates) {
      const path = join(directory, candidate)
      if (existsSync(path)) return path
    }
  }
  return undefined
}
