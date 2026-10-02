/**
 * dsh-worktree — Git worktree isolation for DeepSeek Harness.
 *
 * Provides the `worktree` service and the browser route over it. The service is
 * the seam: a Host consumer (the session-create path, or the GUI's new-session
 * flow) creates a checkout through it and starts a session whose `meta.cwd` is
 * the returned path, which is what makes the checkout a separate project with
 * its own file sandbox and shell working directory.
 *
 * The plugin registers NO model-facing tools. Creating, listing, and removing a
 * checkout are user actions: the browser half owns them, and the one cleanup
 * that must follow from another surface — archiving a session — is wired to the
 * Workspace registry's archive notification instead of being offered to the
 * model (see {@link installArchiveCleanup}).
 *
 * The policy fields are `volatile`: the settings page edits them while the
 * plugin runs, and the entry's document update is what re-installs them on the
 * service. The fields that shape REGISTRATION — whether the route mounts, and
 * whether archiving cleans up — stay ordinary config, because changing one has
 * to re-run `apply` rather than reconfigure a running service.
 * @module @guowenzhang/dsh-worktree
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_AGENTS_DIRECTORY, DEFAULT_GIT_TIMEOUT_MS, DEFAULT_NESTED_REPOSITORIES, DEFAULT_NESTED_SCAN_DEPTH,
  DEFAULT_WORKTREE_LAYOUT, SETTINGS_NAMESPACE, type NestedRepositoryPolicy, type WorktreeLayout,
} from './policy.ts'
import { WorktreeService, type WorktreeServiceOptions } from './service.ts'
import { installArchiveCleanup } from './archive-cleanup.ts'
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

// Every service this plugin consumes (the tool registry excluded — the plugin
// registers no tools) is asked for through `ctx.inject`, so a deployment that
// lacks one still mounts the service instead of failing to activate.

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
  if (config.removeOnSessionArchive ?? true) installArchiveCleanup(ctx, service)
  if (config.startSessionRoute ?? true) registerRoute(ctx, service)
}
