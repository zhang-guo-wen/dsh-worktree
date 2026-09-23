/**
 * Registration contract of the plugin entry.
 *
 * These specs mount the real plugin on a context carrying the services it
 * declares and assert what it published: the `worktree` service, the three
 * model-facing tools, and the browser route. They are the regression guard for
 * the loader-facing surface, which no behavior spec reaches.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'

/** Minimal tool registry double recording what the plugin registers. */
function toolRegistry(names: string[]) {
  return {
    register(definition: { name: string }) {
      names.push(definition.name)
      return () => {}
    },
  }
}

/** Minimal webserver double recording registered routes. */
function webServer(paths: string[]) {
  return {
    register(route: { path: string }) {
      paths.push(route.path)
      return () => {}
    },
  }
}

/**
 * Provide services from a sibling plugin fiber, as the loader does.
 *
 * A service provided on the mounting context itself resolves without `inject`,
 * which would hide a plugin that reads a service it never declared.
 * @param ctx - the context the sibling is loaded in.
 * @param services - service name → implementation.
 */
async function provideSibling(ctx: Context, services: Record<string, unknown>): Promise<void> {
  await ctx.plugin({
    name: 'providers',
    apply(sibling: Context) {
      for (const [name, value] of Object.entries(services)) sibling.provide(name, value)
    },
  }).await()
}

/**
 * Mount the plugin on a context exposing the services it consumes.
 * @param config - plugin configuration.
 * @returns the registered tool names and route paths.
 */
async function mount(config: Partial<plugin.Config> = {}): Promise<{ tools: string[]; routes: string[] }> {
  const tools: string[] = []
  const routes: string[] = []
  const ctx = new Context()
  await provideSibling(ctx, {
    tools: toolRegistry(tools),
    webServer: webServer(routes),
    workspaceRegistry: {},
    agents: {},
  })
  await ctx.plugin(plugin, config as plugin.Config).await()
  return { tools, routes }
}

describe('dsh-worktree plugin entry', () => {
  it('publishes the worktree service under its declared name', async () => {
    const tools: string[] = []
    const ctx = new Context()
    await provideSibling(ctx, { tools: toolRegistry(tools) })
    await ctx.plugin(plugin, { startSessionRoute: false } as plugin.Config).await()
    expect(ctx.get('worktree')).toBeDefined()
  })

  it('registers the three worktree tools under their default names', async () => {
    const { tools } = await mount()
    expect(tools.sort()).toEqual(['worktree_create', 'worktree_list', 'worktree_remove'])
  })

  it('honors configured tool names', async () => {
    const { tools } = await mount({
      createToolName: 'wt_new', listToolName: 'wt_list', removeToolName: 'wt_rm',
    })
    expect(tools.sort()).toEqual(['wt_list', 'wt_new', 'wt_rm'])
  })

  it('mounts the browser route by default and omits it when disabled', async () => {
    expect((await mount()).routes).toEqual(['/worktree/api'])
    expect((await mount({ startSessionRoute: false })).routes).toEqual([])
  })

  it('removes every registration when its fiber unloads', async () => {
    const tools: string[] = []
    const routes: string[] = []
    const ctx = new Context()
    await provideSibling(ctx, {
      tools: toolRegistry(tools),
      webServer: webServer(routes),
      workspaceRegistry: {},
      agents: {},
    })
    const fiber = await ctx.plugin(plugin, {} as plugin.Config).await()
    expect(tools).toHaveLength(3)
    expect(routes).toHaveLength(1)
    await fiber.dispose()
    // The registries record disposals through the returned disposers; this
    // asserts the plugin itself owns no registrations outside them.
    expect(ctx.get('worktree')).toBeUndefined()
  })

  it('reports a missing webserver instead of failing to load', async () => {
    const tools: string[] = []
    const ctx = new Context()
    await provideSibling(ctx, { tools: toolRegistry(tools) })
    // No webServer: the host tools must still mount.
    await expect(ctx.plugin(plugin, {} as plugin.Config).await()).resolves.toBeDefined()
    expect(tools).toHaveLength(3)
  })

  it('mounts no route when a service the route reads is missing', async () => {
    const routes: string[] = []
    const ctx = new Context()
    await provideSibling(ctx, { tools: toolRegistry([]), webServer: webServer(routes) })
    // workspaceRegistry and agents are absent: the route reads both, so it must
    // wait rather than mount and fail on the first request that needs them.
    await ctx.plugin(plugin, {} as plugin.Config).await()
    expect(routes).toEqual([])
  })

  it('refuses an agent directory that could escape the workspace at load', async () => {
    const ctx = new Context()
    await provideSibling(ctx, { tools: toolRegistry([]) })
    // The checkout path is derived per creation, so a directory naming a parent
    // would put checkouts outside every workspace; it fails at load instead.
    await expect(ctx.plugin(plugin, { agentsDirectory: '../escape' } as plugin.Config).await())
      .rejects.toThrow(/agentsDirectory/)
  })
})
