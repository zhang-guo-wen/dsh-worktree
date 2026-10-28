/**
 * The operator's global Git identity: `user.name` and `user.email`.
 *
 * Both keys live in Git's global configuration, which is what a commit made in
 * any checkout on this machine reads. The page shows what is there and writes
 * only what the operator submits: an empty field clears that key instead of
 * storing an empty value, because Git's own lookup treats a missing key and a
 * blank one differently (`git config --unset` is the write that means "no
 * identity").
 *
 * A failure has three shapes, and the page needs all three: Git missing (the
 * operator can install it), Git unable to read the global file (a broken config
 * or a permissions problem), and an invalid submission (the form's own rule).
 * Only the first two describe the machine; the third never reaches Git.
 *
 * Tests never touch the operator's real global file: every call accepts an
 * environment whose `GIT_CONFIG_GLOBAL` points at a scratch file.
 * @module @guowenzhang/dsh-worktree/git-accounts/identity
 */

import { GitCommandError, runGitWithExit } from '../git.ts'
import type { GitIdentity } from './types.ts'

/** Longest display name accepted; Git itself has no bound, so this is a form bound. */
const NAME_MAX_LENGTH = 200

/** Longest email accepted; RFC 5321's maximum mailbox length. */
const EMAIL_MAX_LENGTH = 320

/** A control character never belongs in either identity field, and would corrupt a config line. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u

/** Loose email rule: one `@`, a dot in the domain. Git validates nothing beyond the line format. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/** Git's exit status for `config --unset` on a key that is not set. */
const UNSET_MISSING_CODE = 5

/**
 * One identity failure with a machine code the page or route can explain.
 *
 * `invalid_input` is the form's own refusal; `git_missing` and `git_failed` are
 * the machine's. A route maps the first to a client error and the others to a
 * Host-side failure.
 */
export class GitIdentityError extends Error {
  /**
   * @param code - the failure class.
   * @param message - actionable text; for a Git failure it carries Git's own diagnostic.
   */
  constructor(
    readonly code: 'invalid_input' | 'git_missing' | 'git_failed',
    message: string,
  ) {
    super(message)
    this.name = 'GitIdentityError'
  }
}

/** Extra environment for one Git call; tests point the global config at a scratch file. */
type IdentityEnvironment = Readonly<Record<string, string | undefined>>

/**
 * Read the global identity.
 *
 * An unset key reads as an empty string: first run is not a failure. Git being
 * absent or unable to read its global file is: the page shows which, and
 * disables the form.
 * @param cwd - existing directory the Git process runs in.
 * @param environment - extra environment entries for the Git calls.
 * @returns both keys and whether the read worked.
 */
export async function readGitIdentity(cwd: string, environment?: IdentityEnvironment): Promise<GitIdentity> {
  try {
    const name = await readKey(cwd, 'user.name', environment)
    const email = await readKey(cwd, 'user.email', environment)
    return { name, email, available: true }
  } catch (error: unknown) {
    if (error instanceof GitCommandError && error.code === 'git_not_found') {
      return { name: '', email: '', available: false, error: 'git_missing' }
    }
    // Git itself ran but could not read the global file (a syntax error in it, a
    // permission problem). Leaving the form enabled would promise a write Git
    // cannot make either.
    return { name: '', email: '', available: false, error: 'git_failed' }
  }
}

/**
 * Write the global identity and read it back.
 *
 * Both fields are validated before either is written, so a rejected email never
 * leaves a name committed on its own. An empty field removes that key; removing
 * a key that is already absent is success, matching the operator's intent.
 * @param cwd - existing directory the Git process runs in.
 * @param input - the submitted name and email; empty clears that key.
 * @param environment - extra environment entries for the Git calls.
 * @returns the identity as Git now reports it.
 * @throws {GitIdentityError} when a field is invalid or Git cannot write the configuration.
 */
export async function writeGitIdentity(
  cwd: string,
  input: { readonly name: string; readonly email: string },
  environment?: IdentityEnvironment,
): Promise<GitIdentity> {
  const name = validateName(input.name)
  const email = validateEmail(input.email)
  for (const [key, value] of [['user.name', name], ['user.email', email]] as const) {
    if (value === '') await unsetKey(cwd, key, environment)
    else await setKey(cwd, key, value, environment)
  }
  const identity = await readGitIdentity(cwd, environment)
  if (!identity.available) throw new GitIdentityError('git_failed', 'the Git configuration could not be read back after writing it')
  return identity
}

/**
 * Validate a submitted display name.
 * @param value - the form's value.
 * @returns the trimmed name, or an empty string meaning "clear the key".
 * @throws {GitIdentityError} when the name is too long or carries a control character.
 */
export function validateName(value: string): string {
  const name = value.trim()
  if (name.length > NAME_MAX_LENGTH) throw new GitIdentityError('invalid_input', `user.name must be at most ${NAME_MAX_LENGTH} characters`)
  if (CONTROL_CHARACTERS.test(name)) throw new GitIdentityError('invalid_input', 'user.name must not contain control characters')
  return name
}

/**
 * Validate a submitted email.
 * @param value - the form's value.
 * @returns the trimmed email, or an empty string meaning "clear the key".
 * @throws {GitIdentityError} when the email is too long or not an email address.
 */
export function validateEmail(value: string): string {
  const email = value.trim()
  if (email === '') return email
  if (email.length > EMAIL_MAX_LENGTH) throw new GitIdentityError('invalid_input', `user.email must be at most ${EMAIL_MAX_LENGTH} characters`)
  if (CONTROL_CHARACTERS.test(email)) throw new GitIdentityError('invalid_input', 'user.email must not contain control characters')
  if (!EMAIL_PATTERN.test(email)) throw new GitIdentityError('invalid_input', 'user.email must look like name@example.com')
  return email
}

/**
 * Read one global key.
 * @param cwd - directory the Git process runs in.
 * @param key - the configuration key.
 * @param environment - extra environment entries.
 * @returns the trimmed value, or an empty string when unset.
 * @throws {GitCommandError} when Git is missing or cannot read the configuration.
 */
async function readKey(cwd: string, key: string, environment?: IdentityEnvironment): Promise<string> {
  const result = await runGitWithExit(cwd, ['config', '--global', '--get', key], environment)
  if (result.code === 0) return result.stdout.trim()
  // Exit 1 is Git's "no such key", which is this function's empty answer.
  if (result.code === 1) return ''
  throw new GitCommandError(['config', '--global', '--get', key], cwd, result.stderr.trim() || `git config exited ${result.code}`)
}

/**
 * Set one global key.
 * @param cwd - directory the Git process runs in.
 * @param key - the configuration key.
 * @param value - the non-empty value.
 * @param environment - extra environment entries.
 * @throws {GitIdentityError} when Git refuses the write.
 */
async function setKey(cwd: string, key: string, value: string, environment?: IdentityEnvironment): Promise<void> {
  const result = await runGitWithExit(cwd, ['config', '--global', key, value], environment)
  if (result.code === 0) return
  throw new GitIdentityError('git_failed', `git could not write ${key}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`)
}

/**
 * Remove one global key, treating "already absent" as done.
 * @param cwd - directory the Git process runs in.
 * @param key - the configuration key.
 * @param environment - extra environment entries.
 * @throws {GitIdentityError} when Git refuses the removal.
 */
async function unsetKey(cwd: string, key: string, environment?: IdentityEnvironment): Promise<void> {
  const result = await runGitWithExit(cwd, ['config', '--global', '--unset', key], environment)
  if (result.code === 0 || result.code === UNSET_MISSING_CODE) return
  throw new GitIdentityError('git_failed', `git could not clear ${key}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`)
}
