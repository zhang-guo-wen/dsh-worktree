// @vitest-environment jsdom
/**
 * The Git-account connection card on the worktree settings page.
 *
 * The settings page is where a deployment's operator configures this plugin, so
 * the account connections must be usable from there: list, add, scan, forget,
 * and a hand-off to the panel that browses projects. These cases mount the real
 * settings page over the real policy controller and read the card the way a user
 * does — dialogs and toasts included — with the Host data face replaced by a
 * double.
 *
 * The card reuses the panel's dialogs and scan report; what is asserted here is
 * that the settings surface wires them to the same Host operations, and that the
 * hand-off closes settings before it switches the main panel.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import { WorktreeSettingsController, type WorktreeSettings, type WorktreeSettingsState } from '../src/client/settings-store.ts'
import { WorktreeSettingsSection, type WorktreeSettingsSectionProps } from '../src/client/SettingsSection.tsx'
import type {
  AddAccountResult, GitAccountSummary, GitAccountsInjected, ScanResult,
} from '../src/git-accounts/types.ts'
import { zh, type WorktreeCopyKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The account the first read lists. */
const OCTOCAT: GitAccountSummary = {
  id: 'github-abc123',
  provider: 'github',
  host: 'github.com',
  login: 'octocat',
  auth: 'token',
  verified: true,
  name: 'Octo Cat',
  email: 'octo@example.com',
  addedAt: '2026-10-20T10:00:00.000Z',
  origin: 'manual',
}

/** The account the add dialog produces. */
const NEWUSER: GitAccountSummary = {
  id: 'gitlab-new001',
  provider: 'gitlab',
  host: 'gitlab.arcuchi.com',
  login: 'newuser',
  auth: 'token',
  verified: true,
  addedAt: '2026-10-24T12:00:00.000Z',
  origin: 'manual',
}

/** The account the scan produces. */
const SCANNED: GitAccountSummary = {
  id: 'gitee-scan001',
  provider: 'gitee',
  host: 'gitee.com',
  login: 'gitee-user',
  auth: 'token',
  verified: true,
  addedAt: '2026-10-24T12:10:00.000Z',
  origin: 'environment',
}

/** A Host data face whose answers the case controls. */
interface FakeHost {
  readonly face: GitAccountsInjected
  readonly snapshot: ReturnType<typeof vi.fn>
  readonly addAccount: ReturnType<typeof vi.fn>
  readonly verifyAccount: ReturnType<typeof vi.fn>
  readonly removeAccount: ReturnType<typeof vi.fn>
  readonly scan: ReturnType<typeof vi.fn>
  readonly sshKeys: ReturnType<typeof vi.fn>
}

/**
 * Build a Git-accounts Host face.
 * @param accounts - the accounts the first read lists.
 * @param failure - when set, the first read answers this refusal instead.
 * @returns the face plus the doubles a case asserts on.
 */
function fakeHost(accounts: readonly GitAccountSummary[] = [OCTOCAT], failure?: string): FakeHost {
  const snapshot = vi.fn(async () => failure === undefined
    ? {
      ok: true as const,
      value: { accounts, identity: { name: '', email: '', available: true }, sources: [], platform: 'win32' },
    }
    : { ok: false as const, message: failure })
  const addAccount = vi.fn(async (): Promise<Awaited<ReturnType<GitAccountsInjected['addAccount']>>> => ({
    ok: true,
    value: { account: NEWUSER, created: true } satisfies AddAccountResult,
  }))
  const verifyAccount = vi.fn(async (): Promise<Awaited<ReturnType<GitAccountsInjected['verifyAccount']>>> => ({
    ok: true,
    value: { provider: 'github', auth: 'token', login: 'octocat' },
  }))
  const removeAccount = vi.fn(async (): Promise<Awaited<ReturnType<GitAccountsInjected['removeAccount']>>> => ({
    ok: true,
    value: { removed: true },
  }))
  const scan = vi.fn(async (): Promise<Awaited<ReturnType<GitAccountsInjected['scan']>>> => ({
    ok: true,
    value: {
      report: {
        sources: [],
        examined: 1,
        added: [SCANNED],
        updated: [],
        skipped: [],
        notes: [{ code: 'ssh-keys-found' }],
      },
      accounts: [...accounts, SCANNED],
    } satisfies ScanResult,
  }))
  const sshKeys = vi.fn(async (): Promise<Awaited<ReturnType<GitAccountsInjected['sshKeys']>>> => ({
    ok: true,
    value: { keys: [{ path: 'C:/Users/me/.ssh/id_ed25519', name: 'id_ed25519' }] },
  }))
  const face: GitAccountsInjected = {
    snapshot,
    addAccount: addAccount as unknown as GitAccountsInjected['addAccount'],
    verifyAccount: verifyAccount as unknown as GitAccountsInjected['verifyAccount'],
    removeAccount: removeAccount as unknown as GitAccountsInjected['removeAccount'],
    scan: scan as unknown as GitAccountsInjected['scan'],
    sshKeys: sshKeys as unknown as GitAccountsInjected['sshKeys'],
    projects: async () => ({ ok: false, message: 'not used by the settings card' }),
    saveIdentity: async () => ({ ok: false, message: 'not used by the settings card' }),
  }
  return { face, snapshot, addAccount, verifyAccount, removeAccount, scan, sshKeys }
}

/** Everything a mounted case can assert against. */
interface Mounted {
  readonly host: FakeHost
  /** Navigation calls in order: `close` then `open`. */
  readonly navigation: string[]
}

/**
 * Mount the real settings page over a double for the policy and the Git accounts.
 * @param host - the Git-accounts double.
 * @returns the host double and the recorded navigation calls.
 */
async function mount(host: FakeHost): Promise<Mounted> {
  let snapshot = {
    status: 'ready' as const,
    writable: true,
    revision: 1,
    value: { nestedRepositories: 'none', defaultPath: 'agents', nestedScanDepth: 1 },
    base: {},
    user: {},
  }
  const listeners = new Set<() => void>()
  const scope: SettingsFormScope<WorktreeSettings> = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: async () => {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
      return true
    },
  }
  const face = new WorktreeSettingsController(scope).inject()
  const store = face.hooks.worktreeSettings
  const navigation: string[] = []
  // The real locale reader interpolates `{name}` parameters; the dictionary is
  // read raw here, so the double must interpolate the same way for the copy the
  // cases assert on to be the copy a user reads.
  const t = (key: WorktreeCopyKey, params?: Record<string, string>): string => {
    const text = zh[key]
    if (params === undefined) return text
    return text.replace(/\{(\w+)\}/gu, (match, name: string) => params[name] ?? match)
  }
  const props = {
    useWorktreeSettings: (select: (state: WorktreeSettingsState) => WorktreeSettingsState) =>
      useSyncExternalStore(store.subscribe, () => select(store.getSnapshot())),
    edit: face.edit,
    gitAccounts: host.face,
    openAccountsPage: () => { navigation.push('open') },
    close: () => { navigation.push('close') },
    t,
  } as unknown as WorktreeSettingsSectionProps
  // The page's Git line reads the Host route on mount; that status is not under
  // test, so the read stays open rather than resolving a failure nobody asserted.
  vi.stubGlobal('fetch', () => new Promise(() => {}))
  await act(async () => { render(<WorktreeSettingsSection {...props} />) })
  await act(async () => { await Promise.resolve() })
  return { host, navigation }
}

describe('the Git-account connection card on the settings page', () => {
  it('lists the connected accounts and offers the connection actions', async () => {
    await mount(fakeHost())
    expect(screen.getByText('Git 账号', { selector: 'h3' })).toBeTruthy()
    expect(screen.getByText('octocat')).toBeTruthy()
    expect(screen.getByText('github.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['gitAccounts.accounts.add'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['gitAccounts.accounts.scan'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['gitAccounts.settings.openProjects'] })).toBeTruthy()
  })

  it('adds an account through the shared dialog and reports it', async () => {
    const mounted = await mount(fakeHost())
    screen.getByRole('button', { name: zh['gitAccounts.accounts.add'] }).click()
    await waitFor(() => { expect(screen.getByRole('dialog', { name: zh['gitAccounts.add.title'] })).toBeTruthy() })
    const token = screen.getByPlaceholderText(zh['gitAccounts.add.tokenPlaceholder'])
    fireEvent.change(token, { target: { value: 'ghp_fixture' } })
    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.add.submit'] }).click()
    })
    await waitFor(() => { expect(mounted.host.addAccount).toHaveBeenCalledTimes(1) })
    expect(mounted.host.addAccount).toHaveBeenCalledWith({
      provider: 'github', host: 'github.com', auth: 'token', token: 'ghp_fixture',
    })
    await waitFor(() => { expect(screen.getByText('newuser')).toBeTruthy() })
    expect(screen.getByText(zh['gitAccounts.account.added'].replace('{login}', 'newuser'))).toBeTruthy()
  })

  it('adds an SSH account by choosing one of the machine\'s keys', async () => {
    const mounted = await mount(fakeHost())
    screen.getByRole('button', { name: zh['gitAccounts.accounts.add'] }).click()
    await waitFor(() => { expect(screen.getByRole('dialog', { name: zh['gitAccounts.add.title'] })).toBeTruthy() })

    fireEvent.click(screen.getByRole('tab', { name: zh['gitAccounts.add.auth.ssh'] }))
    const detected = await screen.findByRole('button', { name: 'id_ed25519' })
    fireEvent.click(detected)
    expect(mounted.host.sshKeys).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.add.submit'] }).click()
    })
    await waitFor(() => { expect(mounted.host.addAccount).toHaveBeenCalledTimes(1) })
    expect(mounted.host.addAccount).toHaveBeenCalledWith({
      provider: 'github',
      host: 'github.com',
      auth: 'ssh',
      keyPath: 'C:/Users/me/.ssh/id_ed25519',
    })
    // The SSH form never renders a token field.
    expect(screen.queryByPlaceholderText(zh['gitAccounts.add.tokenPlaceholder'])).toBeNull()
  })

  it('tests one connection from the card without saving it', async () => {
    const mounted = await mount(fakeHost())
    screen.getByRole('button', { name: zh['gitAccounts.accounts.add'] }).click()
    await waitFor(() => { expect(screen.getByRole('dialog', { name: zh['gitAccounts.add.title'] })).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText(zh['gitAccounts.add.tokenPlaceholder']), {
      target: { value: 'ghp_fixture' },
    })

    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.add.verify'] }).click()
    })

    await waitFor(() => { expect(mounted.host.verifyAccount).toHaveBeenCalledTimes(1) })
    expect(mounted.host.verifyAccount).toHaveBeenCalledWith({
      provider: 'github', host: 'github.com', auth: 'token', token: 'ghp_fixture',
    })
    await waitFor(() => {
      expect(screen.getByText(zh['gitAccounts.add.verified']
        .replace('{login}', 'octocat')
        .replace('{provider}', 'GitHub')
        .replace('{host}', 'github.com'))).toBeTruthy()
    })
    expect(mounted.host.addAccount).not.toHaveBeenCalled()
  })

  it('scans, lists what the scan adopted, and shows a toast naming it', async () => {
    const mounted = await mount(fakeHost())
    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.accounts.scan'] }).click()
    })
    await waitFor(() => { expect(mounted.host.scan).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.getByText('gitee-user')).toBeTruthy() })
    // The scan's answer is a toast naming the new account; the card no longer
    // grows a report block for it.
    expect(screen.getByText(zh['gitAccounts.scan.resultAdded']
      .replace('{count}', '1')
      .replace('{logins}', 'gitee-user'))).toBeTruthy()
    expect(screen.queryByText('扫描来源')).toBeNull()
    expect(screen.queryByText('扫描提示')).toBeNull()
  })

  it('forgets an account only after the confirmation', async () => {
    const mounted = await mount(fakeHost())
    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.account.removeOne'].replace('{login}', 'octocat') }).click()
    })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: zh['gitAccounts.remove.title'] })).toBeTruthy() })
    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.remove.confirm'] }).click()
    })
    await waitFor(() => { expect(mounted.host.removeAccount).toHaveBeenCalledWith('github-abc123') })
    await waitFor(() => { expect(screen.queryByText('octocat')).toBeNull() })
  })

  it('closes settings before switching to the Git accounts panel', async () => {
    const mounted = await mount(fakeHost())
    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.settings.openProjects'] }).click()
    })
    expect(mounted.navigation).toEqual(['close', 'open'])
  })

  it('reports a failed read and retries it from the card', async () => {
    const host = fakeHost([], 'the credential store is unavailable')
    const mounted = await mount(host)
    expect(screen.getByText(zh['gitAccounts.loadFailed'].replace('{message}', 'the credential store is unavailable'))).toBeTruthy()
    await act(async () => {
      screen.getByRole('button', { name: zh['gitAccounts.retry'] }).click()
    })
    await waitFor(() => { expect(host.snapshot.mock.calls.length).toBeGreaterThan(1) })
    expect(mounted.host).toBe(host)
  })

  it('says how to fill an empty account list instead of offering the panel to an empty list', async () => {
    await mount(fakeHost([]))
    expect(screen.getByText(zh['gitAccounts.accounts.empty'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['gitAccounts.settings.openProjects'] })).toBeNull()
  })
})
