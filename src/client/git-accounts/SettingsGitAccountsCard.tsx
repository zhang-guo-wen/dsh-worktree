/**
 * The Git-account connection card on the worktree settings page.
 *
 * The settings page is where a deployment's operator looks for "how this plugin
 * talks to Git", so the account connections live there beside the worktree
 * policy rather than only on the standalone Git accounts panel. The card is a
 * compact version of that panel's accounts card: list, add, scan, forget, and a
 * way over to the panel for project browsing. It reuses the same dialogs and
 * scan report — one interaction, one code path — and owns only its own read of
 * the account list, because the settings page and the panel can both be mounted.
 *
 * No token is stored or rendered here: the add dialog keeps the pasted value in
 * its own state until the Host accepts it, exactly as on the panel.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/SettingsGitAccountsCard
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  Button, IconLinkOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, Tag, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AddAccountResult, GitAccountSummary, GitAccountsInjected,
} from '../../git-accounts/types.ts'
import { AddAccountDialog } from './AddAccountDialog.tsx'
import { RemoveAccountDialog } from './RemoveAccountDialog.tsx'
import { PROVIDER_BRANDS, ORIGIN_KEYS, formatDate, scanResultText, type Translate } from './presentation.ts'
import pageCss from './GitAccountsPage.module.css'
import settingsCss from '../SettingsSection.module.css'
import cardCss from './SettingsGitAccountsCard.module.css'

/** What the card currently has to show. */
interface CardState {
  /** `loading` also covers a retry over a list already on screen. */
  readonly status: 'loading' | 'ready' | 'failed'
  /** The accounts the last successful read listed. */
  readonly accounts: readonly GitAccountSummary[]
  /** Why the last read failed, when it did. */
  readonly message?: string
}

/** One floating report; `seq` keys the mounted banner so a repeat restarts it. */
interface Notice {
  readonly text: string
  readonly seq: number
}

/** Props of {@link SettingsGitAccountsCard}. */
export interface SettingsGitAccountsCardProps {
  /** The Host data face shared with the Git accounts panel. */
  readonly gitAccounts: GitAccountsInjected
  /** Leave the settings panel and show the Git accounts panel. */
  readonly onOpenAccountsPage: () => void
  /** This plugin's copy reader. */
  readonly t: Translate
}

/**
 * Render the Git-account connection card.
 * @param props - the Host face, the panel navigation, and copy.
 * @returns the card.
 */
export function SettingsGitAccountsCard({ gitAccounts, onOpenAccountsPage, t }: SettingsGitAccountsCardProps): ReactNode {
  const { snapshot, addAccount, verifyAccount, sshKeys, removeAccount, scan } = gitAccounts
  const [state, setState] = useState<CardState>({ status: 'loading', accounts: [] })
  const [reload, setReload] = useState(0)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<GitAccountSummary | undefined>(undefined)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)

  useEffect(() => {
    let active = true
    setState(current => ({ ...current, status: 'loading' }))
    void snapshot().then(result => {
      if (!active) return
      if (result.ok) {
        setState({ status: 'ready', accounts: result.value.accounts })
        return
      }
      setState(current => ({ ...current, status: 'failed', message: result.message }))
    })
    return () => { active = false }
  }, [snapshot, reload])

  const announce = (text: string): void => {
    setNotice(current => ({ text, seq: (current?.seq ?? 0) + 1 }))
  }

  const handleAdded = (result: AddAccountResult): void => {
    setAddOpen(false)
    setState(current => ({
      ...current,
      accounts: current.accounts.some(account => account.id === result.account.id)
        ? current.accounts.map(account => account.id === result.account.id ? result.account : account)
        : [...current.accounts, result.account],
    }))
    announce(result.account.verified === false
      ? t('gitAccounts.account.addedUnverified', { login: result.account.login })
      : t(
        result.created ? 'gitAccounts.account.added' : 'gitAccounts.account.updated',
        { login: result.account.login },
      ))
  }

  const handleScan = (): void => {
    if (scanning) return
    setScanning(true)
    setScanError(undefined)
    void scan().then(result => {
      setScanning(false)
      if (!result.ok) {
        setScanError(result.message)
        return
      }
      setState(current => ({ ...current, accounts: result.value.accounts }))
      announce(scanResultText(result.value.report, t))
    })
  }

  const handleRemove = (): void => {
    if (removeTarget === undefined || removing) return
    const target = removeTarget
    setRemoving(true)
    setRemoveError(undefined)
    void removeAccount(target.id).then(result => {
      setRemoving(false)
      if (!result.ok) {
        setRemoveError(result.message)
        return
      }
      setRemoveTarget(undefined)
      setState(current => ({
        ...current,
        accounts: current.accounts.filter(account => account.id !== target.id),
      }))
      announce(t('gitAccounts.account.removed', { login: target.login }))
    })
  }

  return (
    <section
      className={settingsCss.card}
      aria-labelledby="worktree-git-accounts-heading"
      data-git-accounts-settings="true"
    >
      <h3 className={settingsCss.cardTitle} id="worktree-git-accounts-heading">{t('gitAccounts.settings.title')}</h3>
      <p className={pageCss.cardDescription}>{t('gitAccounts.settings.description')}</p>
      <div className={cardCss.actions}>
        <Button
          variant="outline"
          size="sm"
          icon={<IconSearchOutlineRegular />}
          disabled={state.status === 'loading' || scanning}
          onClick={handleScan}
        >
          {scanning ? t('gitAccounts.accounts.scanning') : t('gitAccounts.accounts.scan')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<IconPlusOutlineRegular />}
          disabled={state.status === 'loading'}
          onClick={() => { setAddOpen(true) }}
        >
          {t('gitAccounts.accounts.add')}
        </Button>
      </div>
      {state.status === 'failed' && state.message !== undefined
        ? (
          <div className={cardCss.failure} role="status" data-git-accounts-settings-error="true">
            <p className={pageCss.inlineError}>{t('gitAccounts.loadFailed', { message: state.message })}</p>
            <Button variant="outline" size="sm" onClick={() => { setReload(value => value + 1) }}>
              {t('gitAccounts.retry')}
            </Button>
          </div>
        )
        : null}
      {scanError === undefined ? null : (
        <p className={pageCss.inlineError} role="alert" data-scan-error="true">
          {t('gitAccounts.scan.failed', { message: scanError })}
        </p>
      )}
      {state.status === 'loading' && state.accounts.length === 0
        ? <p className={cardCss.statusText} role="status">{t('gitAccounts.loading')}</p>
        : state.accounts.length === 0
          ? (
            <div className={cardCss.empty} data-accounts-empty="true">
              <p className={cardCss.emptyText}>{t('gitAccounts.accounts.empty')}</p>
              <p className={pageCss.emptyHint}>{t('gitAccounts.accounts.emptyHint')}</p>
            </div>
          )
          : (
            <ul className={cardCss.list} aria-label={t('gitAccounts.accounts.list')}>
              {state.accounts.map(account => (
                <li key={account.id} className={cardCss.row} data-account-id={account.id} data-account-provider={account.provider}>
                  <div className={cardCss.rowMain}>
                    <div className={cardCss.rowTitle}>
                      <span className={cardCss.login}>{account.login}</span>
                      <Tag tone="neutral">{PROVIDER_BRANDS[account.provider]}</Tag>
                      {account.auth === 'ssh' ? <Tag tone="outline">{t('gitAccounts.auth.sshBadge')}</Tag> : null}
                      {account.verified ? null : (
                        <span title={t('gitAccounts.account.unverifiedHint')}>
                          <Tag tone="warning">{t('gitAccounts.auth.unverifiedBadge')}</Tag>
                        </span>
                      )}
                      <span className={cardCss.host}>{account.host}</span>
                    </div>
                    <p className={pageCss.accountMeta}>
                      <span>{t('gitAccounts.account.origin', { origin: t(ORIGIN_KEYS[account.origin]) })}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{t('gitAccounts.account.addedAt', { date: formatDate(account.addedAt) })}</span>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={pageCss.dangerAction}
                    aria-label={t('gitAccounts.account.removeOne', { login: account.login })}
                    onClick={() => {
                      setRemoveError(undefined)
                      setRemoveTarget(account)
                    }}
                  >
                    {t('gitAccounts.account.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
      {state.accounts.length === 0 ? null : (
        <Button
          variant="outline"
          size="sm"
          className={cardCss.openPage}
          icon={<IconLinkOutlineRegular />}
          onClick={onOpenAccountsPage}
        >
          {t('gitAccounts.settings.openProjects')}
        </Button>
      )}
      <AddAccountDialog
        open={addOpen}
        onClose={() => { setAddOpen(false) }}
        addAccount={addAccount}
        verifyAccount={verifyAccount}
        sshKeys={sshKeys}
        onAdded={handleAdded}
        t={t}
      />
      <RemoveAccountDialog
        account={removeTarget}
        busy={removing}
        error={removeError}
        onClose={() => {
          if (removing) return
          setRemoveTarget(undefined)
          setRemoveError(undefined)
        }}
        onConfirm={handleRemove}
        t={t}
      />
      {notice === undefined
        ? null
        : (
          <Toast
            key={notice.seq}
            text={notice.text}
            tone="success"
            onDone={() => {
              setNotice(current => current?.seq === notice.seq ? undefined : current)
            }}
          />
        )}
    </section>
  )
}
