/**
 * Model-facing worktree tools.
 *
 * Three tools, each a thin consumer of {@link WorktreeService}: create a linked
 * checkout, list the repository's checkouts, and remove one. None of them
 * starts a session — the model creates a worktree here and the product's own
 * new-session flow (or the session-create path) puts a session inside it. That
 * split is what keeps this plugin from owning session lifecycle.
 * @module @zhang-guo-wen/dsh-worktree/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorktreeService } from './service.ts'

/**
 * The calling session's working directory, which is where repository discovery
 * starts.
 * @param exec - the tool execution context.
 * @returns the session cwd, or undefined when the caller has none.
 */
function sessionCwd(exec: { agent?: { session: { header: { cwd?: string } } } }): string | undefined {
  return exec.agent?.session.header.cwd
}

/**
 * Require the calling session's working directory.
 * @param exec - the tool execution context.
 * @returns the session cwd.
 * @throws {Error} when the caller has no workspace to discover a repository from.
 */
function requireCwd(exec: { agent?: { session: { header: { cwd?: string } } } }): string {
  const cwd = sessionCwd(exec)
  if (cwd === undefined) {
    throw new Error('this tool requires an owning session with a working directory')
  }
  return cwd
}

/**
 * Register the worktree tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param service - the worktree capability the tools consume.
 * @param toolNames - configured tool names.
 */
export function registerTools(
  ctx: Context,
  service: WorktreeService,
  toolNames: { create: string; list: string; remove: string },
): void {
  ctx.tools.register(defineTool({
    name: toolNames.create,
    description:
      'Create an isolated Git worktree of the current repository and return its path. '
      + 'Use it to work on a separate branch without disturbing the current checkout. '
      + 'The new checkout is a DIFFERENT directory: files, git state, and uncommitted '
      + 'changes there are independent of the current one. This tool only creates the '
      + 'checkout — it does not move your session into it.',
    parameters: {
      branch: {
        type: 'string',
        description: 'Branch to create in the new worktree. Omit for a generated name.',
      },
      path: {
        type: 'string',
        description: 'Absolute directory for the checkout. Omit for a sibling of the repository.',
      },
      base: {
        type: 'string',
        description: 'Commit-ish to base the new branch on. Omit for the repository HEAD.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          branch: { type: 'string', required: true },
          head: { type: 'string', required: true },
          repositoryRoot: { type: 'string', required: true },
          sessionStarted: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created worktree ${value.path} on branch ${value.branch} (${value.head.slice(0, 12)}) `
          + `from ${value.repositoryRoot}.`,
      }],
    },
    async execute(args, exec) {
      const created = await service.create({
        cwd: requireCwd(exec),
        ...args.branch === undefined ? {} : { branch: args.branch },
        ...args.path === undefined ? {} : { path: args.path },
        ...args.base === undefined ? {} : { base: args.base },
      })
      return {
        path: created.path,
        branch: created.branch,
        head: created.head,
        repositoryRoot: created.repositoryRoot,
        sessionStarted: false,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.branch === undefined ? 'Create worktree' : `Create worktree ${args.branch}`,
      kind: 'edit',
      ...args.path === undefined ? {} : { locations: [{ path: args.path }] },
    }),
  }))

  ctx.tools.register(defineTool({
    name: toolNames.list,
    description:
      'List the Git worktrees of the current repository, main checkout first. '
      + 'Use it to see which isolated checkouts already exist before creating one.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repositoryRoot: { type: 'string', required: true },
          worktrees: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                branch: { type: 'string', required: true },
                head: { type: 'string', required: true },
                main: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.worktrees.length === 0
          ? `No worktrees found in ${value.repositoryRoot}.`
          : value.worktrees
            .map(entry => `${entry.main ? '* ' : '  '}${entry.path} [${entry.branch}]`)
            .join('\n'),
      }],
    },
    async execute(_args, exec) {
      const cwd = requireCwd(exec)
      const worktrees = await service.list(cwd)
      const repositoryRoot = worktrees[0]?.path ?? cwd
      return {
        repositoryRoot,
        worktrees: worktrees.map(entry => ({
          path: entry.path,
          branch: entry.branch,
          head: entry.head,
          main: entry.main,
        })),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List worktrees', kind: 'search' }),
  }))

  ctx.tools.register(defineTool({
    name: toolNames.remove,
    description:
      'Remove a linked Git worktree created earlier. The main checkout is refused. '
      + 'A worktree with uncommitted changes is refused unless force is set, because '
      + 'removal discards that work.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path of the worktree to remove, as reported by the list tool.',
      },
      force: {
        type: 'boolean',
        description: 'Remove even when the worktree has modifications or untracked files.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          branch: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Removed worktree ${value.path} (branch ${value.branch}).`,
      }],
    },
    async execute(args, exec) {
      const removed = await service.remove({
        cwd: requireCwd(exec),
        path: args.path,
        ...args.force === undefined ? {} : { force: args.force },
      })
      return { path: removed.path, branch: removed.branch }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Remove worktree',
      kind: 'delete',
      locations: [{ path: args.path }],
    }),
  }))
}
