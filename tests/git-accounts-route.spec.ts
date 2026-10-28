/**
 * The `/worktree/git/api` route and the capability behind it.
 *
 * These specs drive the route through a real HTTP server over the real
 * capability, because what matters is the composition: a body arrives, the
 * service verifies or lists, and one JSON answer names what happened. Only the
 * two external edges are doubles — the provider API (`fetch`) and the scan —
 * while the credential provider is an in-memory map implementing the same four
 * record methods the Host's provider exposes.
 *
 * No case talks to a real Git host, reads a real credential, or touches the
 * operator's `~/.gitconfig`: every Git process runs against a scratch global
 * configuration, and the provider stubs answer from fixtures.
 */

import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialRecord, CredentialRecordEntry } from '@deepseek-ai/dsh-credentials'
import { GitAccountsService, type AccountCredentialStore } from '../src/git-accounts/accounts.ts'
import { registerGitAccountsRoute } from '../src/git-accounts/route.ts'
import type { RawScanCandidate, RawScanResult, ScanEnvironment } from '../src/git-accounts/scan.ts'
import { SshVerificationError, type SshProbeResult } from '../src/git-accounts/ssh.ts'
import type { GitProvider, ScanSourceStatus } from '../src/git-accounts/types.ts'

/** A provider fetch captured before any case stubs the global. */
const realFetch = globalThis.fetch

/** Scratch directories the current case created, removed on teardown. */
const created: string[] = []

/** Live servers the current case created, closed on teardown. */
const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => { resolve() })
  })))
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** One in-memory credential provider: the four record methods the capability reads. */
interface FakeStore extends AccountCredentialStore {
  /** Stored records, by full key. */
  readonly entries: Map<string, CredentialRecord>
}

/**
 * Build an in-memory credential provider.
 * @returns the store, seeded empty.
 */
function fakeStore(): FakeStore {
  const entries = new Map<string, CredentialRecord>()
  return {
    entries,
    async listRecords(): Promise<readonly CredentialRecordEntry[]> {
      return [...entries.entries()].map(([key, record]) => ({ key: key as CredentialKey, kind: record.kind }))
    },
    async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
      return entries.get(String(key))
    },
    async modifyRecord(
      key: CredentialKey,
      mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ): Promise<CredentialRecord | undefined> {
      const current = entries.get(String(key))
      const next = await mutate(current)
      if (next !== undefined) entries.set(String(key), next)
      return next ?? current
    },
    async deleteRecord(key: CredentialKey): Promise<void> {
      entries.delete(String(key))
    },
  }
}

/**
 * Build one provider HTTP answer.
 * @param body - JSON body.
 * @param status - HTTP status.
 * @param headers - extra response headers.
 * @returns the response.
 */
function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** GitHub's `/user` answer for the fixture account. */
const GITHUB_PROFILE = {
  login: 'octocat',
  name: 'Octo Cat',
  email: 'octo@example.com',
  html_url: 'https://github.com/octocat',
}

/** GitLab's `/user` answer for the fixture account. */
const GITLAB_PROFILE = {
  username: 'octo',
  name: 'Octo Cat',
  email: 'octo@example.com',
  web_url: 'https://gitlab.com/octo',
}

/** Gitee's `/user` answer for the fixture account. */
const GITEE_PROFILE = {
  login: 'octo',
  name: 'Octo Cat',
  email: 'octo@example.com',
  html_url: 'https://gitee.com/octo',
}

/** One GitHub repository row, as `/user/repos` reports it. */
const GITHUB_REPOSITORY = {
  id: 1,
  full_name: 'octocat/hello',
  name: 'hello',
  description: 'a fixture',
  private: false,
  default_branch: 'main',
  updated_at: '2026-01-01T00:00:00Z',
  html_url: 'https://github.com/octocat/hello',
  clone_url: 'https://github.com/octocat/hello.git',
  ssh_url: 'git@github.com:octocat/hello.git',
}

/** Scan sources a fake scan reports. */
const FAKE_SOURCES: readonly ScanSourceStatus[] = [
  { id: 'credential-manager', supported: process.platform === 'win32', available: process.platform === 'win32' },
  { id: 'git-credentials', supported: true, available: false },
  { id: 'gh-cli', supported: true, available: false },
  { id: 'environment', supported: true, available: true },
  { id: 'ssh', supported: true, available: false },
]

/** What one test mount was built with. */
interface MountOptions {
  /** The credential store; a fresh empty one by default. */
  readonly store?: FakeStore
  /** The scan implementation; an empty scan by default. */
  readonly scan?: (environment: ScanEnvironment) => Promise<RawScanResult>
  /** The provider HTTP answers; every call fails by default. */
  readonly provider?: (url: string, init?: RequestInit) => Response | Promise<Response>
  /** The SSH probe; a fake that refuses unless a case supplies one, so no case opens a connection. */
  readonly verifySsh?: (request: { provider: GitProvider; host: string; keyPath: string }) => Promise<SshProbeResult>
  /** Omit the credential provider, as a deployment without one. */
  readonly withoutCredentials?: boolean
}

/** A mounted route and the state a case asserts against. */
interface Harness {
  /** Base URL ending in `/worktree/git/api`. */
  readonly url: string
  /** The credential store the service reads and writes. */
  readonly store: FakeStore
  /** The scratch home directory the service reads sources from. */
  readonly scratch: string
  /** The SSH requests the fake probe was asked to verify. */
  readonly sshRequests: { provider: GitProvider; host: string; keyPath: string }[]
}

/**
 * Provide services from a sibling plugin fiber, as the loader does.
 * @param ctx - the context the sibling is loaded in.
 * @param services - service name → implementation.
 */
async function provideSibling(ctx: Context, services: Record<string, unknown>): Promise<void> {
  await ctx.plugin({
    name: 'providers',
    apply(sibling: Context) {
      for (const [name, value] of Object.entries(services)) sibling.provide(name, value)
    },
  }).await()
}

/**
 * Mount the Git-accounts route on a live server over a real capability.
 * @param options - the store, scan, and provider doubles.
 * @returns the base URL and the store.
 */
async function mount(options: MountOptions = {}): Promise<Harness> {
  const store = options.store ?? fakeStore()
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-worktree-accounts-'))
  created.push(scratch)
  const sshRequests: { provider: GitProvider; host: string; keyPath: string }[] = []
  const verifySsh = options.verifySsh ?? (async (request: { provider: GitProvider; host: string; keyPath: string }): Promise<SshProbeResult> => {
    sshRequests.push(request)
    throw new Error('the SSH probe was not stubbed')
  })
  const environment: ScanEnvironment = {
    platform: process.platform,
    homeDirectory: scratch,
    environment: {},
  }
  const service = new GitAccountsService({
    credentials: () => options.withoutCredentials === true ? undefined : store,
    scan: options.scan ?? (async () => ({ candidates: [], sources: FAKE_SOURCES, notes: [] })),
    verifySsh: (request) => {
      sshRequests.push(request)
      return verifySsh(request)
    },
    environment,
    // Every Git call reads and writes a scratch global configuration; the
    // operator's own is never in reach.
    git: {
      cwd: scratch,
      environment: { GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', HOME: scratch, USERPROFILE: scratch },
    },
  })
  const provider = options.provider
  if (provider !== undefined) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return await provider(url, init)
    }))
  }
  const ctx = new Context()
  registerGitAccountsRoute(ctx, service)
  await provideSibling(ctx, {
    webServer: {
      register(route: { path: string; handler: (req: never, res: never) => void }) {
        const server = createServer((req, res) => { void route.handler(req as never, res as never) })
        servers.push(server)
        server.listen(0, '127.0.0.1')
        return () => { server.close() }
      },
    },
  })
  await new Promise<void>(resolve => { setImmediate(resolve) })
  const server = servers[servers.length - 1]
  if (server === undefined) throw new Error('the route was never mounted: registerGitAccountsRoute did not wait for webServer')
  await new Promise<void>(resolve => {
    if (server.listening) { resolve(); return }
    server.once('listening', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server has no port')
  return { url: `http://127.0.0.1:${address.port}/worktree/git/api`, store, scratch, sshRequests }
}

/**
 * Call one route method over the real network, bypassing the stubbed provider
 * fetch.
 * @param harness - the mounted route.
 * @param method - route method name.
 * @param body - JSON request body.
 * @returns the status and decoded body.
 */
async function call(
  harness: Harness,
  method: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await realFetch(`${harness.url}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

/** A provider double that accepts exactly one GitHub token and refuses the rest. */
function githubProvider(validToken: string): (url: string, init?: RequestInit) => Response {
  return (url, init) => {
    const headers = init?.headers as Record<string, string> | undefined
    // Request headers are built by the provider spec, whose spelling of the
    // authorization header is not this test's contract; compare case-insensitively.
    const authorization = headers === undefined
      ? undefined
      : Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
    if (url.endsWith('/user')) {
      return authorization === `Bearer ${validToken}` ? json(GITHUB_PROFILE) : json({ message: 'Bad credentials' }, 401)
    }
    return json({ message: 'not found' }, 404)
  }
}

/** Read one stored account payload out of the fake store. */
function storedAccounts(store: FakeStore): readonly Record<string, unknown>[] {
  return [...store.entries.values()].flatMap(record =>
    record.kind === 'grant' && record.payload !== null && typeof record.payload === 'object'
      ? [record.payload as Record<string, unknown>]
      : [])
}

describe('/worktree/git/api', () => {
  it('reports an empty snapshot with the machine sources and an unset identity', async () => {
    const harness = await mount()
    const { status, body } = await call(harness, 'snapshot', {})
    expect(status).toBe(200)
    expect(body).toMatchObject({ accounts: [], identity: { name: '', email: '', available: true }, platform: process.platform })
    expect(body.sources).toHaveLength(5)
  })

  it('verifies and stores a token, then refreshes the existing account instead of adding a second', async () => {
    const harness = await mount({ provider: githubProvider('ghp_valid') })
    const first = await call(harness, 'accounts.add', { provider: 'github', host: 'github.com', token: 'ghp_valid' })
    expect(first.status).toBe(200)
    const account = first.body.account as Record<string, unknown>
    expect(account).toMatchObject({ provider: 'github', host: 'github.com', login: 'octocat', name: 'Octo Cat', origin: 'manual' })
    expect(String(account.id)).toMatch(/^github-[a-z0-9]+$/u)
    expect(storedAccounts(harness.store)).toHaveLength(1)
    const second = await call(harness, 'accounts.add', { provider: 'github', host: 'github.com', token: 'ghp_valid' })
    expect(second.body).toMatchObject({ created: false })
    expect((second.body.account as Record<string, unknown>).id).toBe(account.id)
    expect(storedAccounts(harness.store)).toHaveLength(1)
    const snapshot = await call(harness, 'snapshot', {})
    expect((snapshot.body.accounts as unknown[])).toHaveLength(1)
  })

  it('stores one account per host family after verifying their own answer shape', async () => {
    const harness = await mount({
      provider: (url) => {
        if (url === 'https://api.github.com/user') return json(GITHUB_PROFILE)
        if (url === 'https://gitlab.com/api/v4/user') return json(GITLAB_PROFILE)
        if (url.startsWith('https://gitee.com/api/v5/user')) return json(GITEE_PROFILE)
        return json({ message: 'not found' }, 404)
      },
    })
    for (const [provider, host, token] of [
      ['github', 'github.com', 'ghp_valid'],
      ['gitlab', 'gitlab.com', 'glpat_valid'],
      ['gitee', 'gitee.com', 'gitee_valid'],
    ] as const) {
      const { status } = await call(harness, 'accounts.add', { provider, host, token })
      expect(status).toBe(200)
    }
    const snapshot = await call(harness, 'snapshot', {})
    expect((snapshot.body.accounts as { provider: string }[]).map(account => account.provider)).toEqual(['github', 'gitlab', 'gitee'])
  })

  it('refuses an unverified token with the host status and keeps the store empty', async () => {
    const harness = await mount({ provider: githubProvider('ghp_valid') })
    const { status, body } = await call(harness, 'accounts.add', { provider: 'github', host: 'github.com', token: 'ghp_wrong' })
    expect(status).toBe(401)
    expect(body.error).toMatchObject({ code: 'unauthorized' })
    expect(storedAccounts(harness.store)).toHaveLength(0)
  })

  it('rejects an unsupported provider and an invalid host with invalid_input', async () => {
    const harness = await mount()
    expect((await call(harness, 'accounts.add', { provider: 'bitbucket', host: 'bitbucket.org', token: 'x-token' })).body.error)
      .toMatchObject({ code: 'invalid_input' })
    expect((await call(harness, 'accounts.add', { provider: 'github', host: 'not a host', token: 'x-token' })).body.error)
      .toMatchObject({ code: 'invalid_input' })
  })

  it('removes a stored account and answers account_not_found for an unknown id', async () => {
    const harness = await mount({ provider: githubProvider('ghp_valid') })
    const added = await call(harness, 'accounts.add', { provider: 'github', host: 'github.com', token: 'ghp_valid' })
    const id = (added.body.account as { id: string }).id
    expect(await call(harness, 'accounts.remove', { id })).toMatchObject({ status: 200, body: { removed: true } })
    expect(storedAccounts(harness.store)).toHaveLength(0)
    const again = await call(harness, 'accounts.remove', { id })
    expect(again.status).toBe(404)
    expect(again.body.error).toMatchObject({ code: 'account_not_found' })
  })

  it('reads and writes the global identity through the route', async () => {
    const harness = await mount()
    const written = await call(harness, 'identity.set', { name: 'Ada Lovelace', email: 'ada@example.com' })
    expect(written.status).toBe(200)
    expect(written.body.identity).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com', available: true })
    const snapshot = await call(harness, 'snapshot', {})
    expect(snapshot.body.identity).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' })
    const invalid = await call(harness, 'identity.set', { name: 'Ada', email: 'nope' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toMatchObject({ code: 'invalid_input' })
    expect((await call(harness, 'snapshot', {})).body.identity).toMatchObject({ name: 'Ada Lovelace' })
  })

  it('lists one account project page with visibility, clone URL, and the next-page flag', async () => {
    const harness = await mount({
      provider: (url) => {
        if (url.endsWith('/user')) return json(GITHUB_PROFILE)
        if (url.includes('/user/repos')) {
          return json([GITHUB_REPOSITORY], 200, { link: '<https://api.github.com/user/repos?page=3>; rel="next"' })
        }
        return json({ message: 'not found' }, 404)
      },
    })
    const added = await call(harness, 'accounts.add', { provider: 'github', host: 'github.com', token: 'ghp_valid' })
    const id = (added.body.account as { id: string }).id
    const { status, body } = await call(harness, 'projects.list', { accountId: id, page: 2 })
    expect(status).toBe(200)
    expect(body).toMatchObject({ accountId: id, page: 2, hasMore: true })
    expect((body.projects as Record<string, unknown>[])[0]).toMatchObject({
      accountId: id,
      provider: 'github',
      fullName: 'octocat/hello',
      visibility: 'public',
      defaultBranch: 'main',
      httpsUrl: 'https://github.com/octocat/hello.git',
    })
    const badPage = await call(harness, 'projects.list', { accountId: id, page: 0 })
    expect(badPage.status).toBe(400)
  })

  it('adopts verified scan candidates and reports the ones that stay out', async () => {
    const candidates: RawScanCandidate[] = [
      { host: 'github.com', provider: 'github', token: 'ghp_valid', source: 'environment' },
      { host: 'github.com', provider: 'github', token: 'ghp_expired', source: 'git-credentials' },
    ]
    const harness = await mount({
      provider: githubProvider('ghp_valid'),
      scan: async () => ({ candidates, sources: FAKE_SOURCES, notes: [] }),
    })
    const first = await call(harness, 'accounts.scan', {})
    expect(first.status).toBe(200)
    const report = first.body.report as Record<string, unknown>
    expect(report).toMatchObject({ examined: 2 })
    expect((report.added as unknown[])).toHaveLength(1)
    expect((report.skipped as Record<string, unknown>[])[0]).toMatchObject({ outcome: 'unverified', errorCode: 'unauthorized' })
    expect((first.body.accounts as unknown[])).toHaveLength(1)

    const second = await call(harness, 'accounts.scan', {})
    const secondReport = second.body.report as Record<string, unknown>
    expect((secondReport.added as unknown[])).toHaveLength(0)
    expect((secondReport.skipped as Record<string, unknown>[]).some(row => row.outcome === 'duplicate')).toBe(true)
    expect((second.body.accounts as unknown[])).toHaveLength(1)
  })

  it('probes an unrecognized host until a provider accepts the credential', async () => {
    const harness = await mount({
      provider: (url) => {
        if (url === 'https://git.corp.example/api/v4/user') return json({ message: '401 Unauthorized' }, 401)
        if (url === 'https://git.corp.example/api/v3/user') return json(GITHUB_PROFILE)
        return json({ message: 'not found' }, 404)
      },
      scan: async () => ({
        candidates: [{ host: 'git.corp.example', token: 'corp-token', source: 'credential-manager' }],
        sources: FAKE_SOURCES,
        notes: [],
      }),
    })
    const { status, body } = await call(harness, 'accounts.scan', {})
    expect(status).toBe(200)
    expect((body.accounts as Record<string, unknown>[])[0]).toMatchObject({ provider: 'github', host: 'git.corp.example', login: 'octocat' })
  })

  it('lists this machine\'s SSH private keys for the add dialog', async () => {
    const harness = await mount()
    mkdirSync(join(harness.scratch, '.ssh'), { recursive: true })
    writeFileSync(join(harness.scratch, '.ssh', 'id_ed25519'), 'PRIVATE KEY CONTENT')
    writeFileSync(join(harness.scratch, '.ssh', 'id_rsa'), 'PRIVATE KEY CONTENT')
    writeFileSync(join(harness.scratch, '.ssh', 'id_ed25519.pub'), 'PUBLIC KEY')
    writeFileSync(join(harness.scratch, '.ssh', 'config'), 'Host github-work\n  HostName github.com\n  IdentityFile ~/.ssh/id_rsa\n')

    const { status, body } = await call(harness, 'ssh.keys', {})
    expect(status).toBe(200)
    expect((body.keys as { name: string }[]).map(key => key.name)).toEqual(['id_ed25519', 'id_rsa'])
    // The route answers paths and names only; a private key's contents are never read.
    expect(JSON.stringify(body)).not.toContain('PRIVATE KEY CONTENT')
  })

  it('stores an SSH account by key path, refuses projects for it, and deduplicates it', async () => {
    const harness = await mount({
      verifySsh: async () => ({ profile: { login: 'octocat' }, provider: 'github' }),
    })
    const keyPath = join(harness.scratch, '.ssh', 'id_ed25519')
    const first = await call(harness, 'accounts.add', {
      provider: 'github',
      host: 'github.com',
      auth: 'ssh',
      keyPath,
    })
    expect(first.status).toBe(200)
    const account = first.body.account as Record<string, unknown>
    expect(account).toMatchObject({ provider: 'github', host: 'github.com', login: 'octocat', auth: 'ssh', origin: 'manual' })
    expect(first.body.created).toBe(true)
    expect(account).not.toHaveProperty('token')
    const payload = storedAccounts(harness.store)[0] as Record<string, unknown>
    expect(payload).toMatchObject({ auth: 'ssh', keyPath })
    expect(payload).not.toHaveProperty('token')
    expect(harness.sshRequests).toEqual([{ provider: 'github', host: 'github.com', keyPath }])

    const second = await call(harness, 'accounts.add', {
      provider: 'github',
      host: 'github.com',
      auth: 'ssh',
      keyPath,
    })
    expect(second.body).toMatchObject({ created: false })
    expect((second.body.account as Record<string, unknown>).id).toBe(account.id)

    // An SSH key cannot ask the REST API for projects; the refusal names the remedy.
    const projects = await call(harness, 'projects.list', { accountId: account.id, page: 1 })
    expect(projects.status).toBe(400)
    expect(projects.body.error).toMatchObject({ code: 'ssh_no_api' })
  })

  it('prefers the host family an SSH banner names over the requested one', async () => {
    const harness = await mount({
      verifySsh: async () => ({ profile: { login: 'octo' }, provider: 'gitlab' }),
    })
    const { status, body } = await call(harness, 'accounts.add', {
      provider: 'github',
      host: 'gitlab.arcuchi.com',
      auth: 'ssh',
      keyPath: join(harness.scratch, '.ssh', 'id_ed25519'),
    })
    expect(status).toBe(200)
    expect(body.account).toMatchObject({ provider: 'gitlab', host: 'gitlab.arcuchi.com', auth: 'ssh' })
  })

  it('adopts a verified SSH scan candidate and records its provenance', async () => {
    const keyPath = join(tmpdir(), 'dsh-worktree-ssh-fixture', 'id_ed25519')
    const harness = await mount({
      verifySsh: async () => ({ profile: { login: 'octo' }, provider: 'gitlab' }),
      scan: async () => ({
        candidates: [{ host: 'gitlab.arcuchi.com', provider: 'gitlab', auth: 'ssh', keyPath, source: 'ssh' }],
        sources: FAKE_SOURCES,
        notes: [{ code: 'ssh-keys-found', detail: 'id_ed25519' }],
      }),
    })
    const { status, body } = await call(harness, 'accounts.scan', {})
    expect(status).toBe(200)
    const report = body.report as Record<string, unknown>
    expect((report.added as Record<string, unknown>[])[0]).toMatchObject({ auth: 'ssh', origin: 'ssh-key', login: 'octo' })
    expect((report.notes as unknown[])).toEqual([{ code: 'ssh-keys-found', detail: 'id_ed25519' }])

    const second = await call(harness, 'accounts.scan', {})
    expect(((second.body.report as Record<string, unknown>).skipped as Record<string, unknown>[])[0])
      .toMatchObject({ outcome: 'duplicate', auth: 'ssh' })
  })

  it('tests a token connection without storing it, and refuses a bad token', async () => {
    const harness = await mount({ provider: githubProvider('ghp_valid') })
    const good = await call(harness, 'accounts.verify', { provider: 'github', host: 'github.com', token: 'ghp_valid' })
    expect(good.status).toBe(200)
    expect(good.body).toMatchObject({ provider: 'github', auth: 'token', login: 'octocat' })
    expect(storedAccounts(harness.store)).toHaveLength(0)

    const bad = await call(harness, 'accounts.verify', { provider: 'github', host: 'github.com', token: 'ghp_wrong' })
    expect(bad.status).toBe(401)
    expect(bad.body.error).toMatchObject({ code: 'unauthorized' })
  })

  it('tests an SSH connection without storing it and reports the endpoint that answered', async () => {
    const harness = await mount({
      verifySsh: async () => ({
        profile: { login: 'octocat' },
        provider: 'github',
        endpoint: 'ssh.github.com:443',
      }),
    })
    const { status, body } = await call(harness, 'accounts.verify', {
      provider: 'github',
      host: 'github.com',
      auth: 'ssh',
      keyPath: '/home/me/.ssh/id_ed25519',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ provider: 'github', auth: 'ssh', login: 'octocat', endpoint: 'ssh.github.com:443' })
    expect(storedAccounts(harness.store)).toHaveLength(0)
  })

  it('saves an SSH account unverified while the host is unreachable, then upgrades it', async () => {
    let online = false
    const harness = await mount({
      verifySsh: async () => {
        if (!online) throw new SshVerificationError('network', 'could not reach github.com over SSH')
        return { profile: { login: 'octocat' }, provider: 'github' }
      },
    })
    const keyPath = '/home/me/.ssh/id_ed25519'
    const first = await call(harness, 'accounts.add', { provider: 'github', host: 'github.com', auth: 'ssh', keyPath })
    expect(first.status).toBe(200)
    const unverified = first.body.account as Record<string, unknown>
    expect(unverified).toMatchObject({ auth: 'ssh', verified: false, login: 'id_ed25519' })
    expect(storedAccounts(harness.store)[0]).toMatchObject({ auth: 'ssh', keyPath, verified: false })
    expect(storedAccounts(harness.store)[0]).not.toHaveProperty('token')

    online = true
    const second = await call(harness, 'accounts.add', { provider: 'github', host: 'github.com', auth: 'ssh', keyPath })
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ created: false })
    expect(second.body.account as Record<string, unknown>).toMatchObject({
      id: unverified.id,
      login: 'octocat',
      verified: true,
    })
    expect(storedAccounts(harness.store)).toHaveLength(1)
  })

  it('refuses an SSH key the host rejects instead of saving it unverified', async () => {
    const harness = await mount({
      verifySsh: async () => { throw new SshVerificationError('unauthorized', 'the host refused this key') },
    })
    const { status, body } = await call(harness, 'accounts.add', {
      provider: 'github',
      host: 'github.com',
      auth: 'ssh',
      keyPath: '/home/me/.ssh/id_ed25519',
    })
    expect(status).toBe(401)
    expect(body.error).toMatchObject({ code: 'unauthorized' })
    expect(storedAccounts(harness.store)).toHaveLength(0)
  })

  it('refuses a token when the host is unreachable instead of saving it', async () => {
    const harness = await mount({
      provider: () => { throw new TypeError('fetch failed') },
    })
    const { status, body } = await call(harness, 'accounts.add', {
      provider: 'github',
      host: 'github.com',
      token: 'ghp_valid',
    })
    expect(status).toBe(502)
    expect(body.error).toMatchObject({ code: 'network' })
    expect(storedAccounts(harness.store)).toHaveLength(0)
  })

  it('answers credentials_unavailable when the deployment has no credential provider', async () => {
    const harness = await mount({ withoutCredentials: true })
    const { status, body } = await call(harness, 'snapshot', {})
    expect(status).toBe(503)
    expect(body.error).toMatchObject({ code: 'credentials_unavailable' })
  })

  it('refuses a non-POST request and an unknown method', async () => {
    const harness = await mount()
    const get = await realFetch(`${harness.url}/snapshot`, { method: 'GET' })
    expect(get.status).toBe(405)
    const unknown = await call(harness, 'no.such.method', {})
    expect(unknown.status).toBe(404)
    expect(unknown.body.error).toMatchObject({ stage: 'no.such.method' })
  })
})
