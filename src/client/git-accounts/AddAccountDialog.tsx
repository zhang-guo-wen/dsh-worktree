/**
 * The add-account dialog: pick a host family and an authentication method, then
 * either paste an access token or choose an SSH private key this machine holds.
 *
 * The token never leaves this dialog's own state before the Host accepts it, and
 * closing the dialog clears it. An SSH account stores only the key's path: the
 * form offers the keys `~/.ssh` already exposes (the Host lists their names) and
 * still allows typing another path, while the key's contents are never read by
 * the page or returned by the Host.
 *
 * The two methods exist because they answer different questions: a token can
 * list projects through the provider API, an SSH key cannot. The SSH hint says
 * so before the operator commits, and the projects card repeats it after an SSH
 * account is selected.
 * @module @guowenzhang/dsh-worktree/client/git-accounts/AddAccountDialog
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DEFAULT_PROVIDER_HOSTS,
  GIT_AUTH_METHODS,
  GIT_PROVIDERS,
  type AddAccountResult,
  type GitAccountsErrorCode,
  type GitAccountsInjected,
  type GitAuthMethod,
  type GitProvider,
  type GitSshKey,
} from '../../git-accounts/types.ts'
import { PROVIDER_BRANDS, tokenCreationUrl, type Translate } from './presentation.ts'
import css from './GitAccountsPage.module.css'

/** The dialog form's accessible grouping; the Enter key submits it. */
const FORM_ID = 'git-accounts-add-form'

/** Dictionary key of the token-creation link's text for one provider. */
const TOKEN_LINK_KEYS = {
  github: 'gitAccounts.add.tokenLink.github',
  gitlab: 'gitAccounts.add.tokenLink.gitlab',
  gitee: 'gitAccounts.add.tokenLink.gitee',
} as const

/** The Host's refusal, kept with its machine code so the dialog can localize it. */
interface Refusal {
  readonly code?: GitAccountsErrorCode
  readonly message: string
}

/** What the dialog knows about the keys `~/.ssh` offers. */
type KeyListState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly keys: readonly GitSshKey[] }
  | { readonly status: 'failed' }

/** Props of {@link AddAccountDialog}. */
export interface AddAccountDialogProps {
  /** Whether the dialog is showing. */
  readonly open: boolean
  /** Close request (Escape, mask, the close control, or Cancel). */
  readonly onClose: () => void
  /** The Host write that verifies and stores the credential. */
  readonly addAccount: GitAccountsInjected['addAccount']
  /** The Host probe that tests a connection without storing anything. */
  readonly verifyAccount: GitAccountsInjected['verifyAccount']
  /** The Host read that lists this machine's SSH private keys. */
  readonly sshKeys: GitAccountsInjected['sshKeys']
  /** Receives the accepted account so the page can list it. */
  readonly onAdded: (result: AddAccountResult) => void
  /** This plugin's copy reader. */
  readonly t: Translate
}

/**
 * Render the add-account dialog.
 * @param props - its open state, close request, the Host operations, its success hook, and copy.
 * @returns the dialog, or nothing while closed.
 */
export function AddAccountDialog({ open, onClose, addAccount, verifyAccount, sshKeys, onAdded, t }: AddAccountDialogProps): ReactNode {
  const [provider, setProvider] = useState<GitProvider>('github')
  const [auth, setAuth] = useState<GitAuthMethod>('token')
  const [host, setHost] = useState(DEFAULT_PROVIDER_HOSTS.github)
  const [token, setToken] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [keys, setKeys] = useState<KeyListState>({ status: 'idle' })
  /** Whether the key list was already requested for this opening; reset with the other fields. */
  const keysRequested = useRef(false)
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  /** The last connection test's answer, cleared whenever the inputs it tested change. */
  const [verifyNotice, setVerifyNotice] = useState<{ readonly okay: boolean; readonly text: string } | undefined>(undefined)
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined)

  // Closing discards the secret material and the method rather than keeping them
  // for the next opening: a pasted token is the one field the page must not
  // retain, and a key choice belongs to the account being added.
  useEffect(() => {
    if (open) return
    setToken('')
    setKeyPath('')
    setAuth('token')
    setKeys({ status: 'idle' })
    keysRequested.current = false
    setRefusal(undefined)
    setBusy(false)
    setVerifying(false)
    setVerifyNotice(undefined)
  }, [open])

  // The key list is read when the SSH method is first shown, not when the dialog
  // opens: most adds are token adds and should not touch ~/.ssh. The request is
  // guarded by a ref rather than by the state it sets: keying this effect on the
  // loading state would cancel its own promise in the cleanup.
  useEffect(() => {
    if (!open || auth !== 'ssh' || keysRequested.current) return
    keysRequested.current = true
    let active = true
    setKeys({ status: 'loading' })
    void sshKeys().then(result => {
      if (!active) return
      setKeys(result.ok
        ? { status: 'ready', keys: result.value.keys }
        : { status: 'failed' })
    })
    return () => { active = false }
  }, [open, auth, sshKeys])

  const credentialPresent = auth === 'token' ? token.trim() !== '' : keyPath.trim() !== ''
  const canSubmit = host.trim() !== '' && credentialPresent && !busy && !verifying
  const canVerify = host.trim() !== '' && credentialPresent && !busy && !verifying

  const close = (): void => {
    if (busy || verifying) return
    onClose()
  }

  const chooseProvider = (next: GitProvider): void => {
    setProvider(next)
    setHost(DEFAULT_PROVIDER_HOSTS[next])
    setRefusal(undefined)
    setVerifyNotice(undefined)
  }

  const chooseAuth = (next: string): void => {
    if (next !== 'token' && next !== 'ssh') return
    setAuth(next)
    setRefusal(undefined)
    setVerifyNotice(undefined)
  }

  /** Run the connection test without storing anything. */
  const verify = (): void => {
    if (!canVerify) return
    setVerifying(true)
    setVerifyNotice(undefined)
    setRefusal(undefined)
    void verifyAccount({
      provider,
      host: host.trim(),
      auth,
      ...auth === 'token' ? { token: token.trim() } : { keyPath: keyPath.trim() },
    }).then(result => {
      setVerifying(false)
      if (result.ok) {
        const endpoint = result.value.endpoint
        const facts = {
          login: result.value.login,
          provider: PROVIDER_BRANDS[result.value.provider],
          host: host.trim(),
        }
        setVerifyNotice({
          okay: true,
          text: endpoint === undefined
            ? t('gitAccounts.add.verified', facts)
            : t('gitAccounts.add.verifiedVia', { ...facts, endpoint }),
        })
        return
      }
      setVerifyNotice({
        okay: false,
        text: verifyFailureText(result, auth, t),
      })
    })
  }

  const submit = (): void => {
    if (!canSubmit) return
    setBusy(true)
    setRefusal(undefined)
    setVerifyNotice(undefined)
    void addAccount({
      provider,
      host: host.trim(),
      auth,
      ...auth === 'token' ? { token: token.trim() } : { keyPath: keyPath.trim() },
    }).then(result => {
      setBusy(false)
      if (result.ok) {
        setToken('')
        setKeyPath('')
        onAdded(result.value)
        return
      }
      setRefusal({
        ...result.code === undefined ? {} : { code: result.code },
        message: result.message,
      })
    })
  }

  const refusalText = refusal === undefined
    ? undefined
    : failureText(refusal.code, refusal.message, auth, t)

  const detectedKeys = keys.status === 'ready' ? keys.keys : []

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('gitAccounts.add.title')}
      description={t('gitAccounts.add.description')}
      closeLabel={t('gitAccounts.add.close')}
      {...(css.addDialog === undefined ? {} : { className: css.addDialog })}
      footer={(
        <div className={css.dialogActions}>
          <Button
            variant="outline"
            className={css.verifyAction}
            disabled={!canVerify}
            onClick={verify}
          >
            {verifying ? t('gitAccounts.add.verifying') : t('gitAccounts.add.verify')}
          </Button>
          <Button variant="outline" disabled={busy || verifying} onClick={close}>{t('gitAccounts.add.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? t('gitAccounts.add.submitting') : t('gitAccounts.add.submit')}
          </Button>
        </div>
      )}
    >
      <form
        id={FORM_ID}
        className={css.addForm}
        data-add-auth-method={auth}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className={css.addField}>
          <span className={css.fieldLabel}>{t('gitAccounts.add.provider')}</span>
          <SegmentedControl
            id="git-accounts-add-provider"
            value={provider}
            options={GIT_PROVIDERS.map(value => ({ value, label: PROVIDER_BRANDS[value] }))}
            onChange={chooseProvider}
            label={t('gitAccounts.add.provider')}
            disabled={busy}
          />
        </div>
        <div className={css.addField}>
          <span className={css.fieldLabel}>{t('gitAccounts.add.auth')}</span>
          <SegmentedControl
            id="git-accounts-add-auth"
            value={auth}
            options={GIT_AUTH_METHODS.map(value => ({
              value,
              label: value === 'ssh' ? t('gitAccounts.add.auth.ssh') : t('gitAccounts.add.auth.token'),
            }))}
            onChange={chooseAuth}
            label={t('gitAccounts.add.auth')}
            disabled={busy}
          />
        </div>
        <label className={css.addField}>
          <span className={css.fieldLabel}>{t('gitAccounts.add.host')}</span>
          <input
            className={css.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={host}
            disabled={busy}
            onChange={(event) => {
              setHost(event.target.value)
              setRefusal(undefined)
              setVerifyNotice(undefined)
            }}
          />
        </label>
        {auth === 'ssh'
          ? (
            <>
              <label className={css.addField}>
                <span className={css.fieldLabel}>{t('gitAccounts.add.keyPath')}</span>
                <input
                  className={css.input}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyPath}
                  disabled={busy}
                  data-modal-autofocus
                  placeholder={t('gitAccounts.add.keyPathPlaceholder')}
                  onChange={(event) => {
                    setKeyPath(event.target.value)
                    setRefusal(undefined)
                    setVerifyNotice(undefined)
                  }}
                />
              </label>
              {keys.status === 'loading'
                ? <p className={css.keyHint} role="status">{t('gitAccounts.add.keysLoading')}</p>
                : keys.status === 'failed'
                  ? <p className={css.keyHint}>{t('gitAccounts.add.keysFailed')}</p>
                  : detectedKeys.length === 0
                    ? <p className={css.keyHint}>{t('gitAccounts.add.keysEmpty')}</p>
                    : (
                      <div className={css.keyOptions} aria-label={t('gitAccounts.add.keys')}>
                        <span className={css.fieldLabel}>{t('gitAccounts.add.keys')}</span>
                        {detectedKeys.map(key => (
                          <button
                            key={key.path}
                            type="button"
                            className={css.keyOption}
                            title={key.path}
                            disabled={busy}
                            data-ssh-key={key.name}
                            onClick={() => {
                              setKeyPath(key.path)
                              setRefusal(undefined)
                              setVerifyNotice(undefined)
                            }}
                          >
                            {key.name}
                          </button>
                        ))}
                      </div>
                    )}
              <p className={css.tokenHint}>{t('gitAccounts.add.keyHint')}</p>
            </>
          )
          : (
            <>
              <label className={css.addField}>
                <span className={css.fieldLabel}>{t('gitAccounts.add.token')}</span>
                <input
                  className={css.input}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  disabled={busy}
                  data-modal-autofocus
                  placeholder={t('gitAccounts.add.tokenPlaceholder')}
                  onChange={(event) => {
                    setToken(event.target.value)
                    setRefusal(undefined)
                    setVerifyNotice(undefined)
                  }}
                />
              </label>
              <p className={css.tokenHint}>
                {t('gitAccounts.add.tokenHint')}{' '}
                <a
                  className={css.hintLink}
                  href={tokenCreationUrl(provider, host)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(TOKEN_LINK_KEYS[provider])}
                </a>
              </p>
            </>
          )}
        {verifyNotice === undefined ? null : (
          <p
            className={verifyNotice.okay ? css.verifyOk : css.inlineError}
            role={verifyNotice.okay ? 'status' : 'alert'}
            data-verify-result={verifyNotice.okay ? 'ok' : 'failed'}
          >
            {verifyNotice.text}
          </p>
        )}
        {refusalText === undefined ? null : (
          <p className={css.inlineError} role="alert" data-add-error={refusal?.code ?? 'unknown'}>
            {refusalText}
          </p>
        )}
      </form>
    </Modal>
  )
}

/**
 * Localize one credential failure.
 *
 * A refused SSH key is not a refused token, so the two `unauthorized` cases get
 * different advice; everything else shares the same wording.
 * @param code - the Host's machine code, when it sent one.
 * @param message - the Host's own text, used when no code is known.
 * @param auth - the method that was tested.
 * @param t - the copy reader.
 * @returns the text to show.
 */
function failureText(
  code: GitAccountsErrorCode | undefined,
  message: string,
  auth: GitAuthMethod,
  t: Translate,
): string {
  if (auth === 'ssh' && code === 'unauthorized') return t('gitAccounts.add.failed.sshUnauthorized')
  if (code === 'unauthorized') return t('gitAccounts.add.failed.unauthorized')
  if (code === 'network') return t('gitAccounts.add.failed.network')
  return t('gitAccounts.add.failed', { message })
}

/**
 * Localize one connection-test refusal.
 * @param result - the refused route result.
 * @param auth - the method that was tested.
 * @param t - the copy reader.
 * @returns the text to show.
 */
function verifyFailureText(
  result: { readonly message: string; readonly code?: GitAccountsErrorCode },
  auth: GitAuthMethod,
  t: Translate,
): string {
  return failureText(result.code, result.message, auth, t)
}
