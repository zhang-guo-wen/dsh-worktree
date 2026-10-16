/**
 * dsh-worktree — Git worktree isolation for DeepSeek Harness.
 *
 * Provides the `worktree` service and the browser route over it. The service is
 * the seam: a Host consumer (the session-create path, or the GUI's new-session
 * flow) creates a checkout through it and starts a session whose `meta.cwd` is
 * the returned path, which is what makes the checkout a separate project with
 * its own file sandbox and shell working directory.
 *
 * Checkout creation, listing, and removal are user actions: the browser half
 * owns them, and the one cleanup that must follow from another surface —
 * archiving a session — is wired to the Workspace registry's archive
 * notification instead of being offered to the model (see
 * {@link installArchiveCleanup}). The file guard is the exception: while it is
 * on (the default) the model gets `worktree_backup`, which is how it declares
 * the files a destructive command would touch (see {@link defineBackupTool}).
 *
 * The policy fields are `volatile`: the settings page edits them while the
 * plugin runs, and the entry's document update is what re-installs them on the
 * service. The fields that shape REGISTRATION — whether the route mounts, and
 * whether archiving cleans up — stay ordinary config, because changing one has
 * to re-run `apply` rather than reconfigure a running service.
 * @module @guowenzhang/dsh-worktree
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_AGENTS_DIRECTORY, DEFAULT_DENY_DESTRUCTIVE_COMMANDS, DEFAULT_FILE_GUARD, DEFAULT_GIT_TIMEOUT_MS,
  DEFAULT_NESTED_REPOSITORIES, DEFAULT_NESTED_SCAN_DEPTH, DEFAULT_WORKTREE_LAYOUT, FILE_GUARD_DIRECTORY_SEGMENTS,
  SETTINGS_NAMESPACE,
  type FileGuardOptions, type NestedRepositoryPolicy, type WorktreeLayout,
} from './policy.ts'
import { WorktreeService, type WorktreeServiceOptions } from './service.ts'
import { installArchiveCleanup } from './archive-cleanup.ts'
import { defineBackupTool } from './backup-tool.ts'
import { FileGuard, installFileGuard } from './file-guard.ts'
import { registerRoute } from './route.ts'
// Pulls the `ctx.worktree` service declaration into this program's type face.
import type {} from './types.ts'
// Pulls the settings service declaration and its document event.
import type {} from '@deepseek-ai/dsh-settings'
// Pulls the `ctx.workspaceRegistry` declaration.
import type {} from '@deepseek-ai/dsh-workspace'
// Pulls the `ctx.agents` declaration.
import type {} from '@deepseek-ai/dsh-agent'
// Pulls the `ctx.webServer` declaration.
import type {} from '@deepseek-ai/dsh-host-webserver'

export type {
  WorktreeInfo, CreatedWorktree, CreateWorktreeRequest, RemoveWorktreeRequest, LinkedCheckout,
} from './service.ts'
export { WorktreeService } from './service.ts'

/** Plugin name used by the loader. */
export const name = 'worktree'

export { SETTINGS_NAMESPACE } from './policy.ts'

// Every service this plugin consumes — the tool registry included, which the
// file guard registers into while it is on — is asked for through `ctx.inject`,
// so a deployment that lacks one still mounts the service instead of failing to
// activate.

/** Deployment configuration for the worktree capability. */
export interface Config {
  /**
   * Where a checkout created without an explicit path goes. `agents` (the
   * default) is a directory inside the calling Workspace, so the checkout
   * appears under that Workspace in a workspace tree; `sibling` is a directory
   * beside the repository, named `<repo>-wt-<branch>`; `home` is the user-level
   * `~/.agents/worktree/<branch>`, shared by every workspace on the machine.
   */
  defaultPath: Volatile<WorktreeLayout>
  /**
   * Directory the `agents` layout creates checkouts in, relative to the
   * Workspace. Defaults to `.agents/worktree`; every missing level is created.
   */
  agentsDirectory: Volatile<string>
  /**
   * Which repositories hanging off the caller's checkout come with it.
   * `none` (the default) creates the repository's own checkout alone;
   * `submodules` also materializes the submodules it records; `all`
   * additionally gives every independently nested repository a linked checkout
   * of its own inside the new directory.
   */
  nestedRepositories: Volatile<NestedRepositoryPolicy>
  /**
   * Directory levels searched below a repository root for nested repositories.
   * Defaults to 1: the direct children, which is where a repository's own
   * subprojects sit.
   */
  nestedScanDepth: Volatile<number>
  /** Bound in milliseconds on each git invocation. */
  gitTimeoutMs: Volatile<number>
  /**
   * Whether to mount `/worktree/api`, the route the browser half uses to start
   * a session inside a new checkout.
   */
  startSessionRoute: boolean | undefined
  /**
   * Whether archiving a session removes the linked checkout it runs in.
   *
   * A checkout removed this way is gone with its branch's working tree; the
   * commit history it shared with the main checkout is untouched. A checkout
   * holding uncommitted work is never removed — the refusal is logged and the
   * checkout survives, which is the same rule {@link WorktreeService.remove}
   * applies to an explicit request.
   */
  removeOnSessionArchive: boolean | undefined
  /**
   * Whether a file is copied out of the session's reach before a tool may
   * change it. On by default ({@link DEFAULT_FILE_GUARD}): it is what makes the
   * backups start writing under the user's home directory, so a deployment that
   * would rather not have that turns it off.
   *
   * Backups belong to the session that asked for them and are deleted when that
   * session is archived.
   */
  fileGuard: Volatile<boolean>
  /**
   * Whether a shell command that looks like it deletes files is refused so the
   * model declares its targets first. On by default: a deletion cannot be
   * recovered once it runs, so a false positive costs one retry while a false
   * negative costs unprotected data.
   */
  denyDestructiveCommands: Volatile<boolean>
}

/**
 * Schemastery validation for {@link Config}.
 *
 * Left un-annotated deliberately: `z<Config>` also pins the schema's INPUT type
 * to `Config`, while an object schema accepts every field as optional — which
 * is exactly what a deployment writing only one field needs. The resolved
 * output is what {@link apply} receives, so the interface still describes it.
 */
export const Config = z.object({
  // Every live field carries a default: that is the value a cleared override
  // reverts to, and what gives the field a live reference to read at all.
  defaultPath: z.union(['agents', 'sibling', 'home']).default(DEFAULT_WORKTREE_LAYOUT).volatile(),
  agentsDirectory: z.string().default(DEFAULT_AGENTS_DIRECTORY).volatile(),
  nestedRepositories: z.union(['none', 'submodules', 'all']).default(DEFAULT_NESTED_REPOSITORIES).volatile(),
  nestedScanDepth: z.number().step(1).min(1).default(DEFAULT_NESTED_SCAN_DEPTH).volatile(),
  gitTimeoutMs: z.number().min(0).default(DEFAULT_GIT_TIMEOUT_MS).volatile(),
  startSessionRoute: z.boolean(),
  removeOnSessionArchive: z.boolean().default(true),
  fileGuard: z.boolean().default(DEFAULT_FILE_GUARD).volatile(),
  denyDestructiveCommands: z.boolean().default(DEFAULT_DENY_DESTRUCTIVE_COMMANDS).volatile(),
})

/**
 * Read one running plugin's policy off its live configuration.
 * @param config - the plugin's resolved configuration.
 * @returns the service options those fields currently name.
 */
function liveOptions(config: Config): WorktreeServiceOptions {
  return {
    timeoutMs: config.gitTimeoutMs.get(),
    defaultPath: config.defaultPath.get(),
    agentsDirectory: config.agentsDirectory.get(),
    nestedRepositories: config.nestedRepositories.get(),
    nestedScanDepth: config.nestedScanDepth.get(),
  }
}

/**
 * The deployment's file-protection policy.
 *
 * Only the directory is fixed at activation, because the user's home is a
 * deployment fact rather than a per-session one. The shell policy is read from
 * the live configuration, so a document update applies to the running guard.
 * @param config - the plugin's resolved configuration.
 * @returns the options the guard consumes.
 */
function guardOptions(config: Config): FileGuardOptions {
  return {
    directory: join(homedir(), ...FILE_GUARD_DIRECTORY_SEGMENTS),
    denyDestructiveCommands: config.denyDestructiveCommands.get(),
  }
}

/**
 * Register the worktree service and the surfaces over it.
 * @param ctx - the Host plugin context.
 * @param config - the deployment's worktree policy.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new WorktreeService(liveOptions(config))
  ctx.provide('worktree', service)
  // Every live field is read where it is used, so the service only has to be
  // told that the document moved. Waiting on the settings service keeps a
  // deployment that has none working, with the composition layer alone.
  ctx.inject(['settings'], (scope: Context) => {
    scope.effect(() => scope.on('settings/document-updated', (ns: string) => {
      if (ns !== SETTINGS_NAMESPACE) return
      service.reconfigure(liveOptions(config))
    }), 'dsh-worktree: live policy')
  })
  // The guard object is built first and always: the archive cleanup needs it to
  // end a session's backups, and that promise outlives the protection switch —
  // a session that copied files while the switch was on still has to be cleaned
  // up after it is turned off. Only the protection itself is conditional.
  const protection = config.fileGuard.get()
  const guard = protection ? installFileGuard(ctx, guardOptions(config)) : new FileGuard(guardOptions(config))
  if (protection) {
    // The one model-facing tool. The registry is asked for through `ctx.inject`
    // like every other consumed service: activation order is not guaranteed, and
    // a deployment without a tool registry keeps the guard's own protection
    // instead of failing to activate.
    ctx.inject(['tools'], (scope: Context) => {
      scope.effect(() => scope.tools.register(defineBackupTool(guard)), 'dsh-worktree: declare files to protect')
    })
  }
  // Cleanup is installed unconditionally: `removeOnSessionArchive` decides only
  // whether an archived session's checkout goes, never whether its backups end
  // with it.
  installArchiveCleanup(ctx, service, guard, { removeCheckouts: config.removeOnSessionArchive ?? true })
  if (config.startSessionRoute ?? true) registerRoute(ctx, service)
}
