/**
 * dsh-worktree — Git worktree isolation for DeepSeek Harness.
 *
 * Provides the `worktree` service and the model-facing tools over it. The
 * service is the seam: a Host consumer (the session-create path, or the GUI's
 * new-session flow) creates a checkout through it and starts a session whose
 * `meta.cwd` is the returned path, which is what makes the checkout a separate
 * project with its own file sandbox and shell working directory.
 * @module @zhang-guo-wen/dsh-worktree
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorktreeService } from './service.ts'
import { registerTools } from './tools.ts'
import { registerRoute } from './route.ts'
// Pulls the `ctx.worktree` service declaration into this program's type face.
import type {} from './types.ts'
// Pulls the `ctx.workspaceRegistry` declaration.
import type {} from '@deepseek-ai/dsh-workspace'
// Pulls the `ctx.agents` declaration.
import type {} from '@deepseek-ai/dsh-agent'
// Pulls the `ctx.webServer` declaration.
import type {} from '@deepseek-ai/dsh-host-webserver'

export type { WorktreeInfo, CreatedWorktree, CreateWorktreeRequest, RemoveWorktreeRequest } from './service.ts'
export { WorktreeService } from './service.ts'

/** Plugin name used by the loader. */
export const name = 'worktree'

/**
 * Declared service edges. The tool registry is a hard dependency — the tools
 * cannot register without it. The route's dependencies (`webServer`,
 * `workspaceRegistry`, and `agents`) are declared by `ctx.inject` inside
 * {@link registerRoute} instead, so a deployment without one of them still gets
 * the tools rather than failing to activate.
 */
export const inject = ['tools']

/** Deployment configuration for the worktree capability. */
export interface Config {
  /**
   * Where a checkout created without an explicit path goes. `agents` (the
   * default) is a directory inside the calling Workspace, so the checkout
   * appears under that Workspace in a workspace tree; `sibling` is a directory
   * beside the repository, named `<repo>-wt-<branch>`.
   */
  defaultPath?: 'agents' | 'sibling'
  /**
   * Directory the `agents` layout creates checkouts in, relative to the
   * Workspace. Defaults to `.agents/worktree`; every missing level is created.
   */
  agentsDirectory?: string
  /** Model-facing tool name for creating a worktree. */
  createToolName?: string
  /** Model-facing tool name for listing worktrees. */
  listToolName?: string
  /** Model-facing tool name for removing a worktree. */
  removeToolName?: string
  /** Bound in milliseconds on each git invocation. */
  gitTimeoutMs?: number
  /**
   * Whether to mount `/worktree/api`, the route the browser half uses to start
   * a session inside a new checkout. A deployment that mounts only the host
   * tools turns it off.
   */
  startSessionRoute?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  defaultPath: z.union(['agents', 'sibling']),
  agentsDirectory: z.string(),
  createToolName: z.string(),
  listToolName: z.string(),
  removeToolName: z.string(),
  gitTimeoutMs: z.number(),
  startSessionRoute: z.boolean(),
})

/**
 * Register the worktree service and its model-facing tools.
 * @param ctx - the Host plugin context.
 * @param config - the deployment's worktree policy.
 */
export function apply(ctx: Context, config: Config): void {
  // Every unset policy field is left out rather than defaulted twice: the
  // service owns each default, and a deployment reads them from its README.
  const service = new WorktreeService({
    ...config.gitTimeoutMs === undefined ? {} : { timeoutMs: config.gitTimeoutMs },
    ...config.defaultPath === undefined ? {} : { defaultPath: config.defaultPath },
    ...config.agentsDirectory === undefined ? {} : { agentsDirectory: config.agentsDirectory },
  })
  ctx.provide('worktree', service)
  registerTools(ctx, service, {
    create: config.createToolName ?? 'worktree_create',
    list: config.listToolName ?? 'worktree_list',
    remove: config.removeToolName ?? 'worktree_remove',
  })
  if (config.startSessionRoute ?? true) registerRoute(ctx, service)
}
