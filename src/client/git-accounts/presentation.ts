/**
 * Presentation vocabulary for the Git-accounts page: the dictionary keys its
 * machine codes map to, the brand names that stay untranslated, and the two
 * pieces of derived text the page forms itself (a token-creation address and a
 * formatted date).
 *
 * The mappings are total over the unions the page renders, so a new origin or
 * visibility in `src/git-accounts/types.ts` is a compile error here until the
 * page can name it. Nothing in this module reads the DOM or the Host.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/presentation
 */

import { DEFAULT_PROVIDER_HOSTS, type AccountOrigin, type GitProvider, type GitVisibility, type ScanReport } from '../../git-accounts/types.ts'
import type { WorktreeCopyKey } from '../locales.ts'

/** The page's copy reader: this plugin's dictionary plus `{name}` substitution. */
export type Translate = (key: WorktreeCopyKey, params?: Record<string, string>) => string

/**
 * The brands the three host families are named by. A brand is a proper noun, so
 * it stays as written in every locale; only the sentences around it translate.
 */
export const PROVIDER_BRANDS: Readonly<Record<GitProvider, string>> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitee: 'Gitee',
}

/** Dictionary key naming one account origin. */
export const ORIGIN_KEYS: Readonly<Record<AccountOrigin, WorktreeCopyKey>> = {
  manual: 'gitAccounts.origin.manual',
  'credential-manager': 'gitAccounts.origin.credential-manager',
  'git-credentials': 'gitAccounts.origin.git-credentials',
  'gh-cli': 'gitAccounts.origin.gh-cli',
  environment: 'gitAccounts.origin.environment',
  'ssh-key': 'gitAccounts.origin.ssh-key',
}

/** Dictionary key naming one project visibility. */
export const VISIBILITY_KEYS: Readonly<Record<GitVisibility, WorktreeCopyKey>> = {
  public: 'gitAccounts.visibility.public',
  private: 'gitAccounts.visibility.private',
  internal: 'gitAccounts.visibility.internal',
  unknown: 'gitAccounts.visibility.unknown',
}

/**
 * Turn a scan report into the one line a toast carries.
 *
 * A scan's useful answer is which accounts it added; the counts of updates and
 * skips matter only when nothing was added. The Host still returns the detailed
 * report (sources, notes, skipped rows), but this page renders a normal action
 * notification instead of a result card.
 * @param report - the scan's report.
 * @param t - the copy reader.
 * @returns the toast text.
 */
export function scanResultText(report: ScanReport, t: Translate): string {
  const added = report.added.map(account => account.login)
  if (added.length > 0) {
    return t('gitAccounts.scan.resultAdded', {
      count: String(added.length),
      logins: added.join('、'),
    })
  }
  return t('gitAccounts.scan.resultNone', {
    updated: String(report.updated.length),
    skipped: String(report.skipped.length),
  })
}

/**
 * The page on which one host creates a personal access token.
 *
 * GitLab serves token settings under the entered host, so a self-hosted instance
 * keeps its own address; GitHub and Gitee are named here by the two hosts whose
 * token pages this capability was written against.
 * @param provider - the host family the dialog is adding.
 * @param host - the address typed into the dialog, possibly empty.
 * @returns the absolute token-creation URL to link to.
 */
export function tokenCreationUrl(provider: GitProvider, host: string): string {
  const hostname = host.trim() === '' ? DEFAULT_PROVIDER_HOSTS[provider] : host.trim()
  switch (provider) {
    case 'gitlab':
      return `https://${hostname}/-/user_settings/personal_access_tokens`
    case 'github':
      return 'https://github.com/settings/tokens'
    case 'gitee':
      return 'https://gitee.com/profile/personal_access_tokens'
  }
}

/** The date format the account and project rows share. */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/**
 * Format one ISO timestamp the way the page dates rows.
 *
 * A timestamp the Host reported but the browser cannot parse is shown as it
 * arrived: an unreadable date is still the Host's own answer, and replacing it
 * with a placeholder would hide that the value exists.
 * @param value - ISO 8601 timestamp from the Host.
 * @returns the locale-formatted date, or the original text when unparseable.
 */
export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date)
}
