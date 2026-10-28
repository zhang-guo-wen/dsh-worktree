/**
 * The accounts card: the connected accounts, the two ways to add one, and the
 * report of the last scan.
 *
 * One row is one credential record. It says which host family and host it
 * speaks to, which login it is, where the credential came from, and when it
 * arrived, because "which of my authorizations is this" is answered by those
 * facts rather than by an opaque id. The row's two actions select it for the
 * project list or forget its stored token; forgetting is a confirmation in the
 * page's own dialog, never a row-local click that already happened.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/AccountsCard
 */

import type { ReactNode } from 'react'
import { Button, IconPlusOutlineRegular, IconSearchOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitAccountSummary } from '../../git-accounts/types.ts'
import { ORIGIN_KEYS, PROVIDER_BRANDS, formatDate, type Translate } from './presentation.ts'
import css from './GitAccountsPage.module.css'

/** Props of {@link AccountsCard}. */
export interface AccountsCardProps {
  /** The accounts the page currently lists. */
  readonly accounts: readonly GitAccountSummary[]
  /** The account whose projects the projects card shows, when one is selected. */
  readonly selectedId: string | undefined
  /** Whether a scan is in flight. */
  readonly scanning: boolean
  /** Why the last scan failed, when it did. */
  readonly scanError: string | undefined
  /** Open the add-account dialog. */
  readonly onAdd: () => void
  /** Scan this machine's existing authorizations. */
  readonly onScan: () => void
  /** Show one account's projects. */
  readonly onViewProjects: (account: GitAccountSummary) => void
  /** Ask to forget one account's stored token. */
  readonly onRemove: (account: GitAccountSummary) => void
  /** This plugin's copy reader. */
  readonly t: Translate
}

/**
 * Render the accounts card.
 * @param props - the listed accounts, the scan's state, the row actions, and copy.
 * @returns the card.
 */
export function AccountsCard({
  accounts, selectedId, scanning, scanError, onAdd, onScan, onViewProjects, onRemove, t,
}: AccountsCardProps): ReactNode {
  return (
    <section className={css.card} aria-labelledby="git-accounts-accounts-heading" data-git-accounts-card="accounts">
      <div className={css.cardHead}>
        <div className={css.cardText}>
          <h2 className={css.cardTitle} id="git-accounts-accounts-heading">{t('gitAccounts.accounts.title')}</h2>
          <p className={css.cardDescription}>{t('gitAccounts.accounts.description')}</p>
        </div>
        <div className={css.cardActions}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconSearchOutlineRegular />}
            disabled={scanning}
            onClick={onScan}
          >
            {scanning ? t('gitAccounts.accounts.scanning') : t('gitAccounts.accounts.scan')}
          </Button>
          <Button variant="primary" size="sm" icon={<IconPlusOutlineRegular />} onClick={onAdd}>
            {t('gitAccounts.accounts.add')}
          </Button>
        </div>
      </div>
      {scanError === undefined ? null : (
        <p className={css.inlineError} role="alert" data-scan-error="true">
          {t('gitAccounts.scan.failed', { message: scanError })}
        </p>
      )}
      {accounts.length === 0
        ? (
          <div className={css.empty} data-accounts-empty="true">
            <p className={css.emptyText}>{t('gitAccounts.accounts.empty')}</p>
            <p className={css.emptyHint}>{t('gitAccounts.accounts.emptyHint')}</p>
          </div>
        )
        : (
          <ul className={css.accountList} aria-label={t('gitAccounts.accounts.list')}>
            {accounts.map(account => (
              <AccountRow
                key={account.id}
                account={account}
                selected={account.id === selectedId}
                onViewProjects={onViewProjects}
                onRemove={onRemove}
                t={t}
              />
            ))}
          </ul>
        )}
    </section>
  )
}

/**
 * One account's row.
 * @param props - the account, whether it is selected, the two row actions, and copy.
 * @returns the row.
 */
function AccountRow({ account, selected, onViewProjects, onRemove, t }: {
  readonly account: GitAccountSummary
  readonly selected: boolean
  readonly onViewProjects: (account: GitAccountSummary) => void
  readonly onRemove: (account: GitAccountSummary) => void
  readonly t: Translate
}): ReactNode {
  const brand = PROVIDER_BRANDS[account.provider]
  const nameLine = [account.name, account.email].filter((value): value is string => value !== undefined && value !== '')
  return (
    <li
      className={selected ? `${css.accountRow} ${css.accountRowSelected}` : css.accountRow}
      data-account-id={account.id}
      data-account-provider={account.provider}
      data-account-selected={selected ? 'true' : 'false'}
    >
      <div className={css.accountMain}>
        <div className={css.accountTitleRow}>
          <span className={css.accountLogin}>{account.login}</span>
          <Tag tone="neutral" className={css.accountTag}>{brand}</Tag>
          {account.auth === 'ssh' ? <Tag tone="outline">{t('gitAccounts.auth.sshBadge')}</Tag> : null}
          {account.verified ? null : (
            <span title={t('gitAccounts.account.unverifiedHint')}>
              <Tag tone="warning">{t('gitAccounts.auth.unverifiedBadge')}</Tag>
            </span>
          )}
          <span className={css.accountHost}>{account.host}</span>
        </div>
        {nameLine.length === 0 ? null : (
          <p className={css.accountSub}>{nameLine.join(' · ')}</p>
        )}
        <p className={css.accountMeta}>
          <span>{t('gitAccounts.account.origin', { origin: t(ORIGIN_KEYS[account.origin]) })}</span>
          <span aria-hidden="true"> · </span>
          <span>{t('gitAccounts.account.addedAt', { date: formatDate(account.addedAt) })}</span>
        </p>
      </div>
      <div className={css.accountActions}>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('gitAccounts.account.viewProjectsOne', { login: account.login })}
          onClick={() => { onViewProjects(account) }}
        >
          {t('gitAccounts.account.viewProjects')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={css.dangerAction}
          aria-label={t('gitAccounts.account.removeOne', { login: account.login })}
          onClick={() => { onRemove(account) }}
        >
          {t('gitAccounts.account.remove')}
        </Button>
      </div>
    </li>
  )
}
