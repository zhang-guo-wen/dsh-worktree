/**
 * The Git-accounts page: a global main panel for the machine's Git
 * authorizations, its Git identity, a scan of what this machine already
 * authorizes, and the projects those accounts can reach.
 *
 * The page is registered as one main-panel key and one sidebar row that selects
 * it, so it is not bound to a Session and keeps none of its data in a Session.
 * Everything it reads and writes arrives through the injected face built by
 * `createGitAccountsFace`; the page itself has no transport, no credential
 * access, and no token visible anywhere in its markup.
 *
 * A successful snapshot is retained across refreshes and failures: the cards go
 * on showing what was last read while a banner names the failed read and offers
 * a retry. The three cards answer, in order, who the commits say the operator
 * is, which authorizations this machine holds, and what one of those accounts
 * can list.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/GitAccountsPage
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (`main`) the page is registered into.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  AddAccountResult,
  GitAccountSummary,
  GitAccountsInjected,
  GitIdentity,
} from '../../git-accounts/types.ts'
import { AccountsCard } from './AccountsCard.tsx'
import { AddAccountDialog } from './AddAccountDialog.tsx'
import { IdentityCard } from './IdentityCard.tsx'
import { ProjectsSection } from './ProjectsSection.tsx'
import { RemoveAccountDialog } from './RemoveAccountDialog.tsx'
import { scanResultText } from './presentation.ts'
import css from './GitAccountsPage.module.css'

/** Full component props: the main-panel seat, the data face, and this plugin's copy. */
export type GitAccountsPageProps =
  PropsRuntime<'main'>
  & InjectFace<GitAccountsInjected>
  & PropsLocale<'worktree'>

/** What the page currently has to show. */
interface PageState {
  /** `loading` also covers a refresh over cards already on screen. */
  readonly status: 'loading' | 'ready' | 'failed'
  /** Whether at least one snapshot has been read, so the cards may render. */
  readonly loaded: boolean
  /** The accounts the last successful read listed. */
  readonly accounts: readonly GitAccountSummary[]
  /** The identity the last successful read reported. */
  readonly identity?: GitIdentity
  /** Why the last read failed, when it did. */
  readonly message?: string
}

/** One floating success report; `seq` keys the mounted banner so a repeat restarts it. */
interface Notice {
  readonly text: string
  readonly seq: number
}

/**
 * Render the Git-accounts page.
 * @param props - the main-panel seat, this plugin's copy, and the data face.
 * @returns the page.
 */
export function GitAccountsPage(props: GitAccountsPageProps): ReactNode {
  const { snapshot, addAccount, verifyAccount, sshKeys, removeAccount, scan, projects, saveIdentity, t } = props
  const [state, setState] = useState<PageState>({ status: 'loading', loaded: false, accounts: [] })
  const [reload, setReload] = useState(0)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<GitAccountSummary | undefined>(undefined)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const noticeSeq = useRef(0)

  const announce = (text: string): void => {
    noticeSeq.current += 1
    setNotice({ text, seq: noticeSeq.current })
  }

  // The whole page is one read: accounts, identity, and the scan sources answer
  // together, so a retry re-reads all three rather than mixing generations.
  useEffect(() => {
    let active = true
    setState(current => ({ ...current, status: 'loading' }))
    void snapshot().then(result => {
      if (!active) return
      if (result.ok) {
        setState({
          status: 'ready',
          loaded: true,
          accounts: result.value.accounts,
          identity: result.value.identity,
        })
        return
      }
      setState(current => ({
        ...current,
        status: 'failed',
        message: result.message,
      }))
    })
    return () => { active = false }
  }, [snapshot, reload])

  // A removed or rescanned account can disappear from the list while its
  // projects are on screen; the selection exists only while its account does.
  const selected = state.accounts.find(candidate => candidate.id === selectedId)

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

  const askRemove = (account: GitAccountSummary): void => {
    setRemoveError(undefined)
    setRemoveTarget(account)
  }

  return (
    <section
      className={css.page}
      aria-labelledby="git-accounts-heading"
      aria-busy={state.status === 'loading'}
      data-git-accounts-page="true"
    >
      <div className={css.content}>
        <header className={css.heading}>
          <div className={css.headingText}>
            <h1 className={css.title} id="git-accounts-heading">{t('gitAccounts.title')}</h1>
            <p className={css.description}>{t('gitAccounts.description')}</p>
          </div>
          <div className={css.headingActions}>
            <Button
              variant="ghost"
              size="sm"
              icon={<IconRefreshOutlineRegular />}
              aria-label={t('gitAccounts.refresh')}
              title={t('gitAccounts.refresh')}
              disabled={state.status === 'loading'}
              onClick={() => { setReload(value => value + 1) }}
            />
          </div>
        </header>
        {state.status === 'failed' && state.message !== undefined
          ? (
            <div className={css.errorBanner} role="status" data-git-accounts-error="true">
              <p className={css.errorText}>{t('gitAccounts.loadFailed', { message: state.message })}</p>
              <Button variant="outline" size="sm" onClick={() => { setReload(value => value + 1) }}>
                {t('gitAccounts.retry')}
              </Button>
            </div>
          )
          : null}
        {!state.loaded && state.status === 'loading'
          ? (
            <div className={css.loadingCard} role="status" aria-label={t('gitAccounts.loading')} data-git-accounts-loading="true">
              <span className={css.skeletonLine} />
              <span className={css.skeletonLine} />
              <span className={`${css.skeletonLine} ${css.skeletonLineShort}`} />
            </div>
          )
          : null}
        {state.identity === undefined
          ? null
          : (
            <IdentityCard
              identity={state.identity}
              save={saveIdentity}
              onSaved={(identity: GitIdentity) => { setState(current => ({ ...current, identity })) }}
              t={t}
            />
          )}
        {!state.loaded
          ? null
          : (
            <>
              <AccountsCard
                accounts={state.accounts}
                selectedId={selected?.id}
                scanning={scanning}
                scanError={scanError}
                onAdd={() => { setAddOpen(true) }}
                onScan={handleScan}
                onViewProjects={(account) => { setSelectedId(account.id) }}
                onRemove={askRemove}
                t={t}
              />
              <ProjectsSection
                accounts={state.accounts}
                selectedId={selected?.id}
                onSelect={setSelectedId}
                projects={projects}
                t={t}
              />
            </>
          )}
      </div>
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
