/**
 * The Git identity card: the global `user.name` and `user.email` every commit on
 * this machine records.
 *
 * The form is staged locally and written as one pair, because the Host validates
 * both fields before writing either one. An empty field is the reader's way to
 * clear that key, so the save control stays enabled for an emptied pair and the
 * copy says so; what it cannot do is save a change that is not there, which is
 * why an unchanged pair leaves the control inert.
 *
 * A Host that cannot read Git's global configuration disables the form with the
 * reason beside it instead of offering a save that can only fail.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/IdentityCard
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitAccountsInjected, GitIdentity } from '../../git-accounts/types.ts'
import type { Translate } from './presentation.ts'
import css from './GitAccountsPage.module.css'

/** The save's own feedback, beside the button that started it. */
type SaveFeedback =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string }

/** Props of {@link IdentityCard}. */
export interface IdentityCardProps {
  /** The identity the last successful read reported. */
  readonly identity: GitIdentity
  /** The Host write to call with the staged pair. */
  readonly save: GitAccountsInjected['saveIdentity']
  /** Receives the identity the Host read back after an accepted write. */
  readonly onSaved: (identity: GitIdentity) => void
  /** This plugin's copy reader. */
  readonly t: Translate
}

/**
 * Render the Git identity card.
 * @param props - the identity, the write, its success hook, and copy.
 * @returns the card.
 */
export function IdentityCard({ identity, save, onSaved, t }: IdentityCardProps): ReactNode {
  const [name, setName] = useState(identity.name)
  const [email, setEmail] = useState(identity.email)
  const [feedback, setFeedback] = useState<SaveFeedback>({ kind: 'idle' })
  // The Host's answer is the only source for the fields: a read-back after a
  // save, or an identity the Host reports differently, replaces whatever was
  // staged. A refresh that reports the same pair does not, because overwriting a
  // draft the reader is typing for values that did not change is a lost edit.
  const lastSynced = useRef(identity)
  useEffect(() => {
    const previous = lastSynced.current
    lastSynced.current = identity
    if (previous.name === identity.name
      && previous.email === identity.email
      && previous.available === identity.available) return
    setName(identity.name)
    setEmail(identity.email)
  }, [identity])

  const available = identity.available
  const saving = feedback.kind === 'saving'
  const dirty = name.trim() !== identity.name || email.trim() !== identity.email
  const disabled = !available || saving

  const submit = (): void => {
    if (disabled || !dirty) return
    setFeedback({ kind: 'saving' })
    void save({ name: name.trim(), email: email.trim() }).then(result => {
      if (!result.ok) {
        setFeedback({ kind: 'failed', message: result.message })
        return
      }
      setFeedback({ kind: 'saved' })
      onSaved(result.value.identity)
    })
  }

  const reason = identity.error === 'git_missing'
    ? t('gitAccounts.identity.gitMissing')
    : t('gitAccounts.identity.gitFailed')

  return (
    <section className={css.card} aria-labelledby="git-accounts-identity-heading" data-git-accounts-card="identity">
      <div className={css.cardHead}>
        <div className={css.cardText}>
          <h2 className={css.cardTitle} id="git-accounts-identity-heading">{t('gitAccounts.identity.title')}</h2>
          <p className={css.cardDescription}>{t('gitAccounts.identity.description')}</p>
        </div>
      </div>
      {available ? null : (
        <p className={css.warning} role="status" data-identity-unavailable="true">
          {t('gitAccounts.identity.unavailable')} {reason}
        </p>
      )}
      <div className={css.form}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('gitAccounts.identity.name')}</span>
          <input
            className={css.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={name}
            disabled={disabled}
            placeholder={t('gitAccounts.identity.namePlaceholder')}
            onChange={(event) => {
              setName(event.target.value)
              setFeedback({ kind: 'idle' })
            }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('gitAccounts.identity.email')}</span>
          <input
            className={css.input}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            disabled={disabled}
            placeholder={t('gitAccounts.identity.emailPlaceholder')}
            onChange={(event) => {
              setEmail(event.target.value)
              setFeedback({ kind: 'idle' })
            }}
          />
        </label>
        <div className={css.formActions}>
          <Button variant="primary" disabled={disabled || !dirty} onClick={submit}>
            {saving ? t('gitAccounts.identity.saving') : t('gitAccounts.identity.save')}
          </Button>
          <span
            className={feedback.kind === 'failed' ? `${css.feedback} ${css.feedbackFailed}` : css.feedback}
            role="status"
            data-identity-feedback={feedback.kind}
          >
            {feedback.kind === 'saved'
              ? t('gitAccounts.identity.saved')
              : feedback.kind === 'failed'
                ? t('gitAccounts.identity.saveFailed', { message: feedback.message })
                : null}
          </span>
        </div>
      </div>
    </section>
  )
}
