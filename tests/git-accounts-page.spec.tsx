// @vitest-environment jsdom
/**
 * The Git-accounts page's behavior.
 *
 * The page is the only surface that shows this machine's Git accounts, writes
 * the global Git identity, adopts a scan of existing authorizations, and lists
 * one account's projects, so the cases below cover the actions a reader takes
 * and the states they have to see: an empty page, a listed account, the add and
 * remove dialogs, the scan's report, a save's success and refusal, a project
 * page with its search and pagination, and the rule that a failed read keeps
 * what was already read.
 *
 * The injected face is fed directly — the main-panel seat's standard hooks are
 * never called by the page, so the prop object carries stubs for them — which
 * makes each case assert what the page renders rather than how the slot
 * machinery drives it.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { GitAccountsPage, type GitAccountsPageProps } from '../src/client/git-accounts/GitAccountsPage.tsx'
import { GitAccountsIcon } from '../src/client/git-accounts/GitAccountsIcon.tsx'
import type { GitAccountsInjected } from '../src/git-accounts/types.ts'
import type {
  AddAccountResult,
  GitAccountSummary,
  GitAccountsSnapshot,
  GitIdentity,
  GitProject,
  GitProjectPage,
  GitRouteResult,
  ScanReport,
  ScanResult,
  ScanSourceStatus,
} from '../src/git-accounts/types.ts'
import { zh, type WorktreeCopyKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

/** This plugin's copy, with the placeholders the page passes filled in. */
function copy(key: WorktreeCopyKey, params: Record<string, string> = {}): string {
  return zh[key].replace(/\{(\w+)\}/gu, (_, name: string) => params[name] ?? '')
}

/** One route answer carrying a value. */
function ok<T>(value: T): Promise<GitRouteResult<T>> {
  return Promise.resolve({ ok: true, value })
}

/** A promise whose settlement the case controls, for asserting a control's busy state. */
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** The sources a Windows machine would report. */
const SOURCES: readonly ScanSourceStatus[] = [
  { id: 'credential-manager', available: true, supported: true },
  { id: 'git-credentials', available: false, supported: true },
  { id: 'gh-cli', available: true, supported: true },
  { id: 'environment', available: false, supported: true },
]

/** The operator's identity as a fresh machine reports it. */
function identity(overrides: Partial<GitIdentity> = {}): GitIdentity {
  return { name: '', email: '', available: true, ...overrides }
}

/** One connected account. */
function account(overrides: Partial<GitAccountSummary> = {}): GitAccountSummary {
  return {
    id: 'github-aaaa',
    provider: 'github',
    host: 'github.com',
    login: 'octocat',
    auth: 'token',
    verified: true,
    name: 'The Octocat',
    email: 'octocat@github.com',
    profileUrl: 'https://github.com/octocat',
    addedAt: '2026-01-02T03:04:05.000Z',
    origin: 'manual',
    scopes: 'repo',
    ...overrides,
  }
}

/** The page's first read. */
function snapshotView(overrides: Partial<GitAccountsSnapshot> = {}): GitAccountsSnapshot {
  return { accounts: [], identity: identity(), sources: SOURCES, platform: 'win32', ...overrides }
}

/** One project an account can reach. */
function project(name: string, overrides: Partial<GitProject> = {}): GitProject {
  return {
    id: `id-${name}`,
    accountId: 'github-aaaa',
    provider: 'github',
    fullName: `acme/${name}`,
    name,
    description: `The ${name} project`,
    visibility: 'private',
    defaultBranch: 'main',
    updatedAt: '2026-02-03T04:05:06.000Z',
    webUrl: `https://github.com/acme/${name}`,
    httpsUrl: `https://github.com/acme/${name}.git`,
    sshUrl: `git@github.com:acme/${name}.git`,
    ...overrides,
  }
}

/** One page of projects. */
function projectPage(projects: readonly GitProject[], hasMore = false, page = 1): GitProjectPage {
  return { accountId: 'github-aaaa', page, hasMore, projects }
}

/** One scan's report. */
function scanReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return { sources: SOURCES, examined: 1, added: [], updated: [], skipped: [], notes: [], ...overrides }
}

/** What one mount exposes to a case. */
interface Mounted {
  /** The snapshot read. */
  readonly snapshot: Mock<GitAccountsInjected['snapshot']>
  /** The token write. */
  readonly addAccount: Mock<GitAccountsInjected['addAccount']>
  /** The connection test. */
  readonly verifyAccount: Mock<GitAccountsInjected['verifyAccount']>
  /** The removal. */
  readonly removeAccount: Mock<GitAccountsInjected['removeAccount']>
  /** The machine scan. */
  readonly scan: Mock<GitAccountsInjected['scan']>
  /** One project page read. */
  readonly projects: Mock<GitAccountsInjected['projects']>
  /** The identity write. */
  readonly saveIdentity: Mock<GitAccountsInjected['saveIdentity']>
}

/** The route answers one case stubs. */
interface Stubs {
  readonly snapshot?: GitAccountsInjected['snapshot']
  readonly addAccount?: GitAccountsInjected['addAccount']
  readonly verifyAccount?: GitAccountsInjected['verifyAccount']
  readonly removeAccount?: GitAccountsInjected['removeAccount']
  readonly scan?: GitAccountsInjected['scan']
  readonly projects?: GitAccountsInjected['projects']
  readonly saveIdentity?: GitAccountsInjected['saveIdentity']
}

/**
 * Mount the page over stubbed reads and writes.
 * @param stubs - the answers one case overrides; the rest succeed with an empty account list.
 * @returns the mocks the page called.
 */
async function mount(stubs: Stubs = {}): Promise<Mounted> {
  const snapshot = vi.fn(async (): ReturnType<GitAccountsInjected['snapshot']> =>
    stubs.snapshot === undefined ? ok(snapshotView()) : stubs.snapshot())
  const addAccount = vi.fn(async (input: Parameters<GitAccountsInjected['addAccount']>[0]): ReturnType<GitAccountsInjected['addAccount']> =>
    stubs.addAccount === undefined ? ok<AddAccountResult>({ account: account(), created: true }) : stubs.addAccount(input))
  const verifyAccount = vi.fn(async (input: Parameters<GitAccountsInjected['verifyAccount']>[0]): ReturnType<GitAccountsInjected['verifyAccount']> =>
    stubs.verifyAccount === undefined
      ? ok({ provider: input.provider, auth: input.auth ?? 'token', login: 'octocat' })
      : stubs.verifyAccount(input))
  const removeAccount = vi.fn(async (id: string): ReturnType<GitAccountsInjected['removeAccount']> =>
    stubs.removeAccount === undefined ? ok({ removed: true as const }) : stubs.removeAccount(id))
  const scan = vi.fn(async (): ReturnType<GitAccountsInjected['scan']> =>
    stubs.scan === undefined ? ok<ScanResult>({ report: scanReport(), accounts: [] }) : stubs.scan())
  const projects = vi.fn(async (accountId: string, page: number): ReturnType<GitAccountsInjected['projects']> =>
    stubs.projects === undefined ? ok(projectPage([], false, page)) : stubs.projects(accountId, page))
  const saveIdentity = vi.fn(async (input: Parameters<GitAccountsInjected['saveIdentity']>[0]): ReturnType<GitAccountsInjected['saveIdentity']> =>
    stubs.saveIdentity === undefined
      ? ok({ identity: identity({ name: input.name, email: input.email }) })
      : stubs.saveIdentity(input))
  const face: GitAccountsInjected = {
    snapshot: () => snapshot(),
    addAccount: input => addAccount(input),
    verifyAccount: input => verifyAccount(input),
    removeAccount: id => removeAccount(id),
    scan: () => scan(),
    sshKeys: () => Promise.resolve({ ok: false, message: 'not used by these cases' }),
    projects: (accountId, page) => projects(accountId, page),
    saveIdentity: input => saveIdentity(input),
  }
  const props = {
    ...face,
    // The page never calls the main seat's standard hooks; the occurrence the
    // real renderer supplies them from is the only stub these cases need.
    usePanelInfo: () => ({ activePanelId: null }),
    t: (key: WorktreeCopyKey, params?: Record<string, string>) => copy(key, params),
  } as unknown as GitAccountsPageProps
  await act(async () => { render(<GitAccountsPage {...props} />) })
  return { snapshot, addAccount, verifyAccount, removeAccount, scan, projects, saveIdentity }
}

/** The account list's rows, in listing order. */
function accountRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-account-id]'))
}

/** The project list's rows, in listing order. */
function projectRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-project-id]'))
}

/** The project list's paths, in listing order. */
function projectPaths(): (string | null)[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-project-path]'))
    .map(element => element.getAttribute('data-project-path'))
}

/** Open the add-account dialog and paste a token. */
async function openAddDialog(token = 'tok-123'): Promise<HTMLElement> {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.accounts.add') })) })
  const dialog = screen.getByRole('dialog', { name: copy('gitAccounts.add.title') })
  await act(async () => {
    fireEvent.change(within(dialog).getByLabelText(copy('gitAccounts.add.token')), { target: { value: token } })
  })
  return dialog
}

/** Select the first account's projects. */
async function viewFirstAccountProjects(login = 'octocat'): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.account.viewProjectsOne', { login }) }))
  })
}

describe('the Git-accounts page', () => {
  it('shows the page heading and explains every card before anything is connected', async () => {
    await mount()

    expect(screen.getByRole('heading', { level: 1, name: copy('gitAccounts.title') })).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.accounts.empty'))).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.accounts.emptyHint'))).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.projects.emptyNoAccount'))).toBeDefined()
    // The identity form is there even with no account: it belongs to the machine.
    expect((screen.getByLabelText(copy('gitAccounts.identity.name')) as HTMLInputElement).value).toBe('')
    expect(accountRows()).toHaveLength(0)
    // The page is a panel, not a Session surface: nothing rendered a Session id.
    expect(screen.getByRole('heading', { level: 2, name: copy('gitAccounts.identity.title') })).toBeDefined()
  })

  it('lists each account with its provider, host, login, origin and added date', async () => {
    await mount({
      snapshot: async () => ok(snapshotView({
        accounts: [
          account(),
          account({
            id: 'gitlab-bbbb',
            provider: 'gitlab',
            host: 'gitlab.arcuchi.com',
            login: 'guowen',
            name: undefined,
            email: undefined,
            origin: 'credential-manager',
          }),
        ],
      })),
    })

    const rows = accountRows()
    expect(rows.map(row => row.getAttribute('data-account-id'))).toEqual(['github-aaaa', 'gitlab-bbbb'])
    expect(rows.map(row => row.getAttribute('data-account-provider'))).toEqual(['github', 'gitlab'])
    const first = within(rows[0]!)
    expect(first.getByText('octocat')).toBeDefined()
    expect(first.getByText('github.com')).toBeDefined()
    expect(first.getByText('The Octocat · octocat@github.com')).toBeDefined()
    expect(first.getByText(copy('gitAccounts.account.origin', { origin: copy('gitAccounts.origin.manual') }))).toBeDefined()
    const second = within(rows[1]!)
    expect(second.getByText('guowen')).toBeDefined()
    expect(second.getByText('gitlab.arcuchi.com')).toBeDefined()
    expect(second.getByText(copy('gitAccounts.account.origin', {
      origin: copy('gitAccounts.origin.credential-manager'),
    }))).toBeDefined()
    expect(second.getByText('GitLab')).toBeDefined()
  })

  it('adds an account through the dialog and lists it without rendering the token', async () => {
    const mounted = await mount({
      addAccount: async () => ok<AddAccountResult>({
        account: account({ id: 'github-new', login: 'newbie', name: 'New Bie' }),
        created: true,
      }),
    })
    const dialog = await openAddDialog('tok-secret')
    expect((within(dialog).getByLabelText(copy('gitAccounts.add.host')) as HTMLInputElement).value).toBe('github.com')

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy('gitAccounts.add.submit') }))
    })

    expect(mounted.addAccount.mock.calls).toEqual([[
      { provider: 'github', host: 'github.com', auth: 'token', token: 'tok-secret' },
    ]])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(accountRows()[0]!).getByText('newbie')).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.account.added', { login: 'newbie' }))).toBeDefined()
    expect(document.body.textContent).not.toContain('tok-secret')
  })

  it('keeps the add dialog open when the token is rejected and localizes the reason', async () => {
    const mounted = await mount({
      addAccount: async () => Promise.resolve({ ok: false, message: 'bad credentials', code: 'unauthorized' }),
    })
    const dialog = await openAddDialog()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy('gitAccounts.add.submit') }))
    })

    expect(mounted.addAccount).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: copy('gitAccounts.add.title') })).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.add.failed.unauthorized'))).toBeDefined()
    expect(accountRows()).toHaveLength(0)
  })

  it('follows the chosen provider with its default host and a token link on that host', async () => {
    await mount()
    const dialog = await openAddDialog()

    await act(async () => { fireEvent.click(within(dialog).getByRole('tab', { name: 'GitLab' })) })

    const host = within(dialog).getByLabelText(copy('gitAccounts.add.host')) as HTMLInputElement
    expect(host.value).toBe('gitlab.com')
    const link = within(dialog).getByRole('link', { name: copy('gitAccounts.add.tokenLink.gitlab') })
    expect(link.getAttribute('href')).toBe('https://gitlab.com/-/user_settings/personal_access_tokens')

    await act(async () => { fireEvent.change(host, { target: { value: 'gitlab.arcuchi.com' } }) })

    expect(
      within(dialog).getByRole('link', { name: copy('gitAccounts.add.tokenLink.gitlab') }).getAttribute('href'),
    ).toBe('https://gitlab.arcuchi.com/-/user_settings/personal_access_tokens')
  })

  it('clears the pasted token when the add dialog is dismissed', async () => {
    await mount()
    const dialog = await openAddDialog('tok-secret')
    expect((within(dialog).getByLabelText(copy('gitAccounts.add.token')) as HTMLInputElement).value).toBe('tok-secret')

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy('gitAccounts.add.cancel') }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()

    const reopened = await openAddDialog('')
    expect((within(reopened).getByLabelText(copy('gitAccounts.add.token')) as HTMLInputElement).value).toBe('')
    expect(document.body.textContent).not.toContain('tok-secret')
  })

  it('removes an account only after the confirmation', async () => {
    const mounted = await mount({ snapshot: async () => ok(snapshotView({ accounts: [account()] })) })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.account.removeOne', { login: 'octocat' }) }))
    })
    expect(mounted.removeAccount).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: copy('gitAccounts.remove.title') })
    expect(within(dialog).getByText(copy('gitAccounts.remove.description', {
      login: 'octocat',
      host: 'github.com',
    }))).toBeDefined()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy('gitAccounts.remove.confirm') }))
    })

    expect(mounted.removeAccount.mock.calls).toEqual([['github-aaaa']])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(accountRows()).toHaveLength(0)
    expect(screen.getByText(copy('gitAccounts.account.removed', { login: 'octocat' }))).toBeDefined()
  })

  it('keeps the remove dialog and the row when the Host refuses the removal', async () => {
    await mount({
      snapshot: async () => ok(snapshotView({ accounts: [account()] })),
      removeAccount: async () => Promise.resolve({ ok: false, message: 'credential store is read-only' }),
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.account.removeOne', { login: 'octocat' }) }))
    })
    const dialog = screen.getByRole('dialog', { name: copy('gitAccounts.remove.title') })

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy('gitAccounts.remove.confirm') }))
    })

    expect(screen.getByText(copy('gitAccounts.remove.failed', { message: 'credential store is read-only' }))).toBeDefined()
    expect(screen.getByRole('dialog', { name: copy('gitAccounts.remove.title') })).toBeDefined()
    expect(accountRows()).toHaveLength(1)
  })

  it('scans existing authorizations, names the added account in a toast, and lists it', async () => {
    const adopted = account({ id: 'gitee-cccc', provider: 'gitee', host: 'gitee.com', login: 'guowen', origin: 'environment' })
    const pending = deferred<GitRouteResult<ScanResult>>()
    const mounted = await mount({ scan: () => pending.promise })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.accounts.scan') }))
    })
    // Busy is visible on the control that started the scan, and it cannot be
    // started twice while the Host is still reading the machine.
    expect(screen.getByRole('button', { name: copy('gitAccounts.accounts.scanning') }).hasAttribute('disabled')).toBe(true)
    expect(mounted.scan).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve({
        ok: true,
        value: {
          accounts: [adopted],
          report: scanReport({
            examined: 2,
            added: [adopted],
            skipped: [{ host: 'old.example', source: 'environment', outcome: 'unknown-host' }],
            notes: [{ code: 'ssh-keys-found' }],
          }),
        },
      })
    })

    expect(screen.getByRole('button', { name: copy('gitAccounts.accounts.scan') })).toBeDefined()
    expect(accountRows().map(row => row.getAttribute('data-account-id'))).toEqual(['gitee-cccc'])
    // The result is a normal notification naming what was added, not a report
    // card: no summary/notes/sources block is rendered on the page.
    expect(screen.getByText(copy('gitAccounts.scan.resultAdded', { count: '1', logins: 'guowen' }))).toBeDefined()
    expect(screen.queryByText('扫描来源')).toBeNull()
    expect(screen.queryByText('扫描提示')).toBeNull()
  })

  it('tests one connection from the add dialog without saving it', async () => {
    const mounted = await mount({
      verifyAccount: async input => ok({
        provider: input.provider,
        auth: input.auth ?? 'token',
        login: 'octocat',
      }),
    })
    const dialog = await openAddDialog('tok-secret')

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: copy('gitAccounts.add.verify') }))
      await Promise.resolve()
    })

    expect(mounted.verifyAccount).toHaveBeenCalledWith({
      provider: 'github',
      host: 'github.com',
      auth: 'token',
      token: 'tok-secret',
    })
    expect(screen.getByText(copy('gitAccounts.add.verified', {
      login: 'octocat',
      provider: 'GitHub',
      host: 'github.com',
    }))).toBeDefined()
    expect(mounted.addAccount).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('tok-secret')
  })

  it('keeps the listed accounts and says why a scan failed', async () => {
    await mount({
      snapshot: async () => ok(snapshotView({ accounts: [account()] })),
      scan: async () => Promise.resolve({ ok: false, message: 'credential manager refused', code: 'credentials_unavailable' }),
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.accounts.scan') }))
    })

    expect(screen.getByText(copy('gitAccounts.scan.failed', { message: 'credential manager refused' }))).toBeDefined()
    expect(within(accountRows()[0]!).getByText('octocat')).toBeDefined()
  })

  it('saves the Git identity and shows the values the Host read back', async () => {
    const mounted = await mount({
      snapshot: async () => ok(snapshotView({ identity: identity({ name: 'Jane', email: 'jane@example.com' }) })),
      saveIdentity: async input => ok({ identity: identity({ name: input.name, email: input.email }) }),
    })
    const name = screen.getByLabelText(copy('gitAccounts.identity.name')) as HTMLInputElement
    const email = screen.getByLabelText(copy('gitAccounts.identity.email')) as HTMLInputElement
    expect(name.value).toBe('Jane')
    expect(email.value).toBe('jane@example.com')

    await act(async () => { fireEvent.change(name, { target: { value: '  Jane Doe  ' } }) })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.identity.save') }))
    })

    expect(mounted.saveIdentity.mock.calls).toEqual([[{ name: 'Jane Doe', email: 'jane@example.com' }]])
    expect(screen.getByText(copy('gitAccounts.identity.saved'))).toBeDefined()
    expect((screen.getByLabelText(copy('gitAccounts.identity.name')) as HTMLInputElement).value).toBe('Jane Doe')
  })

  it('keeps an identity draft when a refresh reports the same values', async () => {
    await mount({
      snapshot: async () => ok(snapshotView({ identity: identity({ name: 'Jane', email: 'jane@example.com' }) })),
    })

    await act(async () => {
      fireEvent.change(screen.getByLabelText(copy('gitAccounts.identity.name')), { target: { value: 'Draft Name' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.refresh') }))
    })

    // The read reported the pair the form already had staged, so it must not
    // overwrite the draft the reader is typing.
    expect((screen.getByLabelText(copy('gitAccounts.identity.name')) as HTMLInputElement).value).toBe('Draft Name')
  })

  it('reports a refused identity save beside the form', async () => {
    await mount({
      snapshot: async () => ok(snapshotView({ identity: identity({ name: 'Jane', email: 'jane@example.com' }) })),
      saveIdentity: async () => Promise.resolve({ ok: false, message: 'git config is locked', code: 'git_failed' }),
    })

    await act(async () => {
      fireEvent.change(screen.getByLabelText(copy('gitAccounts.identity.name')), { target: { value: 'Jane Doe' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.identity.save') }))
    })

    expect(screen.getByText(copy('gitAccounts.identity.saveFailed', { message: 'git config is locked' }))).toBeDefined()
  })

  it('disables the identity form and explains a missing Git', async () => {
    await mount({
      snapshot: async () => ok(snapshotView({ identity: identity({ available: false, error: 'git_missing' }) })),
    })

    expect((screen.getByLabelText(copy('gitAccounts.identity.name')) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(copy('gitAccounts.identity.email')) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(copy('gitAccounts.identity.unavailable'), { exact: false })).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.identity.gitMissing'), { exact: false })).toBeDefined()
    expect(screen.getByRole('button', { name: copy('gitAccounts.identity.save') }).hasAttribute('disabled')).toBe(true)
  })

  it('lists the projects of the selected account with their visibility, branch and links', async () => {
    const widgets = project('widgets')
    const internal = project('secret-tools', { visibility: 'internal', fullName: 'acme/secret-tools' })
    const mounted = await mount({
      snapshot: async () => ok(snapshotView({ accounts: [account()] })),
      projects: async (_accountId, page) => ok(projectPage([widgets, internal], false, page)),
    })

    await viewFirstAccountProjects()

    expect(mounted.projects.mock.calls).toEqual([['github-aaaa', 1]])
    expect(projectPaths()).toEqual(['acme/widgets', 'acme/secret-tools'])
    expect(projectRows().map(row => row.getAttribute('data-project-visibility'))).toEqual(['private', 'internal'])
    expect(screen.getAllByText('acme/')).toHaveLength(2)
    expect(screen.getByText('widgets')).toBeDefined()
    expect(screen.getByText('The widgets project')).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.visibility.private'))).toBeDefined()
    expect(screen.getByText(copy('gitAccounts.visibility.internal'))).toBeDefined()
    expect(screen.getAllByText(copy('gitAccounts.projects.branch', { branch: 'main' })).length).toBe(2)
    expect(screen.getByText(copy('gitAccounts.projects.count', { count: '2' }))).toBeDefined()
    expect(screen.getByRole('link', { name: copy('gitAccounts.projects.openOne', { name: 'widgets' }) }).getAttribute('href'))
      .toBe('https://github.com/acme/widgets')
  })

  it('appends the next page and filters the loaded rows by name', async () => {
    const widgets = project('widgets')
    const secrets = project('secrets', { fullName: 'acme/secrets' })
    const mounted = await mount({
      snapshot: async () => ok(snapshotView({ accounts: [account()] })),
      projects: async (_accountId, page) => page === 1
        ? ok(projectPage([widgets], true, 1))
        : ok(projectPage([secrets], false, 2)),
    })
    await viewFirstAccountProjects()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.projects.loadMore') }))
    })

    expect(mounted.projects.mock.calls).toEqual([['github-aaaa', 1], ['github-aaaa', 2]])
    expect(projectRows()).toHaveLength(2)
    expect(screen.queryByRole('button', { name: copy('gitAccounts.projects.loadMore') })).toBeNull()

    const search = screen.getByRole('searchbox', { name: copy('gitAccounts.projects.search') })
    await act(async () => { fireEvent.change(search, { target: { value: 'secret' } }) })
    expect(projectPaths()).toEqual(['acme/secrets'])
    expect(screen.getByText(copy('gitAccounts.projects.searchCount', { shown: '1', total: '2' }))).toBeDefined()

    await act(async () => { fireEvent.change(search, { target: { value: 'nothing' } }) })
    expect(projectRows()).toHaveLength(0)
    expect(screen.getByText(copy('gitAccounts.projects.noMatch'))).toBeDefined()
  })

  it('copies the HTTPS clone URL and reports a refused copy', async () => {
    const widgets = project('widgets')
    const clipboard: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          clipboard.push(text)
          return Promise.resolve()
        },
      },
    })
    await mount({
      snapshot: async () => ok(snapshotView({ accounts: [account()] })),
      projects: async (_accountId, page) => ok(projectPage([widgets], false, page)),
    })
    await viewFirstAccountProjects()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.projects.copyOne', { name: 'widgets' }) }))
    })
    expect(clipboard).toEqual(['https://github.com/acme/widgets.git'])
    expect(screen.getByRole('button', { name: copy('gitAccounts.projects.copyOne', { name: 'widgets' }) }).textContent)
      .toBe(copy('gitAccounts.projects.copied'))

    // The clipboard can refuse (permissions, an insecure context): the row says
    // so instead of leaving the copy that did nothing looking successful.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.projects.copyOne', { name: 'widgets' }) }))
    })
    expect(screen.getByRole('button', { name: copy('gitAccounts.projects.copyOne', { name: 'widgets' }) }).textContent)
      .toBe(copy('gitAccounts.projects.copyFailed'))
  })

  it('keeps a failed project read on screen and re-reads it on retry', async () => {
    let reads = 0
    await mount({
      snapshot: async () => ok(snapshotView({ accounts: [account()] })),
      projects: async (_accountId, page) => {
        reads += 1
        return reads === 1
          ? Promise.resolve({ ok: false, message: 'the host refused the project list', code: 'network' })
          : ok(projectPage([project('widgets')], false, page))
      },
    })
    await viewFirstAccountProjects()

    expect(screen.getByText(copy('gitAccounts.projects.failed', { message: 'the host refused the project list' }))).toBeDefined()
    expect(projectRows()).toHaveLength(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.retry') }))
    })

    expect(reads).toBe(2)
    expect(projectRows()).toHaveLength(1)
    expect(screen.queryByText(copy('gitAccounts.projects.failed', { message: 'the host refused the project list' }))).toBeNull()
  })

  it('keeps the loaded projects when loading another page fails', async () => {
    const widgets = project('widgets')
    let reads = 0
    await mount({
      snapshot: async () => ok(snapshotView({ accounts: [account()] })),
      projects: async (_accountId, page) => {
        reads += 1
        return reads === 1
          ? ok(projectPage([widgets], true, page))
          : Promise.resolve({ ok: false, message: 'the next page is unreachable', code: 'network' })
      },
    })
    await viewFirstAccountProjects()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.projects.loadMore') }))
    })

    expect(screen.getByText(copy('gitAccounts.projects.failed', { message: 'the next page is unreachable' }))).toBeDefined()
    // The rows already read stay: the failure belongs to the page that was not
    // read, not to the page that was.
    expect(projectRows()).toHaveLength(1)
    expect(screen.getByText('widgets')).toBeDefined()
  })

  it('keeps the last good snapshot when a refresh fails, and recovers on retry', async () => {
    let reads = 0
    const mounted = await mount({
      snapshot: async () => {
        reads += 1
        if (reads === 1) return Promise.resolve({ ok: false, message: 'the route is unreachable', code: 'network' })
        if (reads === 2) return ok(snapshotView({ accounts: [account()] }))
        return Promise.resolve({ ok: false, message: 'the route dropped again', code: 'network' })
      },
    })

    expect(screen.getByText(copy('gitAccounts.loadFailed', { message: 'the route is unreachable' }))).toBeDefined()
    expect(screen.queryByRole('heading', { level: 2, name: copy('gitAccounts.accounts.title') })).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.retry') }))
    })
    expect(mounted.snapshot).toHaveBeenCalledTimes(2)
    expect(accountRows()).toHaveLength(1)

    // A refresh over a loaded page keeps the accounts: the banner is the only
    // thing that changes.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: copy('gitAccounts.refresh') }))
    })

    expect(screen.getByText(copy('gitAccounts.loadFailed', { message: 'the route dropped again' }))).toBeDefined()
    expect(within(accountRows()[0]!).getByText('octocat')).toBeDefined()
    expect(accountRows()).toHaveLength(1)
  })

  it('renders the sidebar icon at the size the sidebar asks for', () => {
    const iconProps = { size: 16, active: false } as unknown as Parameters<typeof GitAccountsIcon>[0]
    const view = render(<GitAccountsIcon {...iconProps} />)
    const icon = view.container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('width')).toBe('16')
  })
})
