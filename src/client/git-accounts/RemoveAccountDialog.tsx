/**
 * The confirmation that forgets one account's stored token.
 *
 * Forgetting is the one destructive action on this page, so it happens behind a
 * dialog that names the account and its host, and a refused removal keeps the
 * dialog open with the Host's reason rather than closing as if it worked.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/RemoveAccountDialog
 */

import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitAccountSummary } from '../../git-accounts/types.ts'
import type { Translate } from './presentation.ts'
import css from './GitAccountsPage.module.css'

/** Props of {@link RemoveAccountDialog}. */
export interface RemoveAccountDialogProps {
  /** The account the reader asked to remove; the dialog is closed while undefined. */
  readonly account: GitAccountSummary | undefined
  /** Whether the removal is in flight. */
  readonly busy: boolean
  /** Why the last attempt failed, when it did. */
  readonly error: string | undefined
  /** Dismiss the dialog without removing anything. */
  readonly onClose: () => void
  /** Remove the account's stored token. */
  readonly onConfirm: () => void
  /** This plugin's copy reader. */
  readonly t: Translate
}

/**
 * Render the remove-account confirmation.
 * @param props - the target account, the request's state, both actions, and copy.
 * @returns the dialog, or nothing while no removal is pending.
 */
export function RemoveAccountDialog({ account, busy, error, onClose, onConfirm, t }: RemoveAccountDialogProps): ReactNode {
  // Escape and the mask are close requests too; while the Host is forgetting the
  // token, dismissing the dialog would hide the answer to a click already made.
  const close = (): void => {
    if (!busy) onClose()
  }
  return (
    <Modal
      open={account !== undefined}
      onClose={close}
      title={t('gitAccounts.remove.title')}
      closeLabel={t('gitAccounts.remove.close')}
      description={account === undefined
        ? ''
        : t('gitAccounts.remove.description', { login: account.login, host: account.host })}
      {...(css.removeDialog === undefined ? {} : { className: css.removeDialog })}
      footer={(
        <div className={css.dialogActions}>
          <Button variant="outline" disabled={busy} onClick={close}>{t('gitAccounts.remove.cancel')}</Button>
          <Button
            variant="outline"
            className={css.confirmDanger}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? t('gitAccounts.remove.removing') : t('gitAccounts.remove.confirm')}
          </Button>
        </div>
      )}
    >
      {error === undefined ? null : (
        <p className={css.inlineError} role="alert" data-remove-error="true">
          {t('gitAccounts.remove.failed', { message: error })}
        </p>
      )}
    </Modal>
  )
}
