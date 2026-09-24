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
