/**
 * Session creation for a new checkout.
 *
 * Creating a Session outside the GUI's own path means reproducing what that
 * path settles before it calls `ctx.agents.create`: the model selection an
 * Agent needs to run at all, and the composition (tools, prompt, persona) the
 * Session is composed from. Calling `agents.create` with only an id and a cwd
 * produces an Agent that cannot answer a request, and the failure surfaces as
 * an opaque error from deep inside the loop.
 *
 * The two dependencies are optional services read with `ctx.get`: a deployment
 * that composes no default model or no presets still gets a Session, composed
 * as plainly as that deployment allows.
 * @module @zhang-guo-wen/dsh-worktree/session
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
// Type-only: pulls the `ctx.agentDefaultModel` service declaration.
import type {} from '@deepseek-ai/dsh-agent-default-model'
// Type-only: pulls the `ctx.agentPresets` service declaration.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

/** The model an Agent runs on, as the deployment's default resolves it. */
interface DefaultModelService {
  currentSelection(): { provider: string; model: string }
}

/** The preset roster, as mounting one composition needs it. */
interface PresetService {
  resolve(id: string | undefined): Promise<{ id: string }>
  mount(ctx: Context, id: string): Promise<void>
}

/**
 * Read the deployment's default model selection.
 * @param ctx - Host context.
 * @returns agent options naming a provider and model, or an empty object when the deployment composes no default.
 */
function agentOptions(ctx: Context): AgentOptions {
  const defaults = ctx.get('agentDefaultModel') as DefaultModelService | undefined
  if (defaults === undefined) return {}
  const { provider, model } = defaults.currentSelection()
  return { provider, model }
}

/**
 * Build the composition an Agent is created under.
 *
 * A deployment without a preset registry composes the Agent with no extra
 * mounted plugins; one with a registry mounts the resolved preset, which is
 * what gives the Session its tools and prompt. The requested preset is resolved
 * against the roster so the durable session header records an id the roster
 * actually has.
 * @param ctx - Host context.
 * @param presetId - requested preset id, or undefined for the deployment default.
 * @returns the resolved preset id and the setup callback.
 */
async function compose(
  ctx: Context,
  presetId: string | undefined,
): Promise<{ agentPreset?: string; setup: AgentSetup }> {
  const presets = ctx.get('agentPresets') as PresetService | undefined
  if (presets === undefined) return { setup: () => {} }
  const resolvedId = (await presets.resolve(presetId)).id
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx: Context) => { await presets.mount(agentCtx, resolvedId) },
  }
}

/**
 * Start a Session whose working directory is the given checkout.
 *
 * `meta.cwd` is the whole point: the Session's header carries it, and every
 * shell, filesystem, sandbox, and search consumer derives its workspace from
 * that field.
 * @param ctx - Host context carrying the agent registry.
 * @param cwd - the checkout the Session runs in.
 * @param presetId - requested Agent preset, or undefined for the deployment default.
 * @returns the started Session id.
 */
export async function startSessionIn(
  ctx: Context,
  cwd: string,
  presetId: string | undefined,
): Promise<string> {
  const composition = await compose(ctx, presetId)
  const handle = await ctx.agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    agentOptions: agentOptions(ctx),
    meta: {
      cwd,
      ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
    },
    setup: composition.setup,
  })
  return handle.agent.id
}
