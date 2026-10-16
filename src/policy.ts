/**
 * The values both halves of this plugin agree on.
 *
 * The Host validates the policy in its Config schema and the browser renders
 * the same values as pickers, so the two must agree on more than a type name.
 * Nothing here imports anything: that is what lets the browser bundle use it
 * without pulling a Node module into the page.
 * @module @guowenzhang/dsh-worktree/policy
 */

/**
 * Settings namespace the worktree page edits: the profile entry's id, which is
 * also the key the Host serves that entry's live form under.
 */
export const SETTINGS_NAMESPACE = 'worktree'

/** Which repositories hanging off a checkout come with it. */
export const NESTED_REPOSITORY_POLICIES = ['none', 'submodules', 'all'] as const

/** One nested-repository policy. */
export type NestedRepositoryPolicy = (typeof NESTED_REPOSITORY_POLICIES)[number]

/** Where a checkout created without an explicit path goes. */
export const WORKTREE_LAYOUTS = ['agents', 'sibling', 'home'] as const

/** One checkout layout. */
export type WorktreeLayout = (typeof WORKTREE_LAYOUTS)[number]

/**
 * What each policy field resolves to when no layer sets it.
 *
 * These are the Config schema's defaults and the service's fallbacks at once:
 * the schema needs one to produce a live reference at all, and the service
 * needs one when a caller constructs it directly, so a second copy would be a
 * second answer to the same question.
 */
export const DEFAULT_WORKTREE_LAYOUT: WorktreeLayout = 'agents'
/** Default checkout directory under the workspace. */
export const DEFAULT_AGENTS_DIRECTORY = '.agents/worktree'
/**
 * Default policy for the repositories a checkout carries.
 *
 * Off by default: materializing submodules runs git over the network, and a
 * checkout per nested repository writes a branch into repositories the parent
 * does not track, so neither is something a user should discover after the
 * fact.
 */
export const DEFAULT_NESTED_REPOSITORIES: NestedRepositoryPolicy = 'none'
/** Default depth of the nested-repository search. */
export const DEFAULT_NESTED_SCAN_DEPTH = 1
/** Default bound on one git invocation. */
export const DEFAULT_GIT_TIMEOUT_MS = 60_000

/**
 * Whether files are copied out of the workspace before a tool may change them.
 *
 * On by default: a protection nobody switched on protects nothing. The cost is
 * bounded by the files actually touched — one copy each, kept for the session's
 * lifetime and deleted when it is archived — so a default-on deployment
 * accumulates nothing it does not use.
 */
export const DEFAULT_FILE_GUARD = true

/**
 * Whether a shell command that looks like it deletes files is refused.
 *
 * On by default. A deletion cannot be recovered once it runs, and the refusal
 * tells the model what to do instead, so the cost of a false positive is one
 * retry while the cost of a false negative is unprotected loss.
 */
export const DEFAULT_DENY_DESTRUCTIVE_COMMANDS = true

/**
 * Whether a new session starts inside a worktree without being asked.
 *
 * Off by default. Turning it on spends the new-session control before anyone
 * touches it: the first blank session in a repository becomes a checkout, which
 * is a Git write and a new branch, so a deployment that wants it says so — and a
 * deployment that does not must not discover it after the fact.
 */
export const DEFAULT_NEW_SESSION_WORKTREE = false

/**
 * Whether the file-backup page is offered in the right sidebar.
 *
 * On by default, and for the same reason the protection itself is: copies are
 * already being taken, so a deployment that keeps them silent hides the one
 * surface that can put a file back. Off, the page is not registered at all —
 * no tab type, no entry on the sidebar's guide page — which is the switch a
 * user turns off to keep the sidebar to the pages they chose.
 */
export const DEFAULT_BACKUP_SIDEBAR = true

/**
 * Directory under the user's home that holds every workspace's protected files.
 *
 * Named for what it is rather than for "snapshots": the contents are ordinary
 * files in the workspace's own layout, kept so a change can be undone.
 */
export const FILE_GUARD_DIRECTORY_SEGMENTS = ['.agents', 'file-guard'] as const

/**
 * The deployment's file-protection policy, as the guard consumes it.
 *
 * There is no retention field and no clock: one copy is kept per file forever,
 * so neither a retention sweep nor a timestamped name exists to configure.
 */
export interface FileGuardOptions {
  /** Root directory holding every workspace's protected files. */
  readonly directory: string
  /** Whether to refuse a shell command that looks like it deletes files. */
  readonly denyDestructiveCommands: boolean
}
