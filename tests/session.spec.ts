/**
 * Session creation for a new checkout.
 *
 * `ctx.agents.create` needs more than an identity and a directory: an Agent
 * with no model cannot answer a request, and one with no mounted preset has no
 * tools. These cases pin the three inputs the GUI's own create path settles —
 * model selection, preset composition, and the header cwd — because omitting
 * them fails deep inside the loop as an opaque error.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { startSessionIn } from '../src/session.ts'

/** Options the fake registry received. */
interface Captured {
  sessionId?: unknown
  agentOptions?: unknown
  meta?: { cwd?: string; agentPreset?: string }
  setup?: unknown
}

/**
 * Mount a context with the services session creation consumes.
 * @param options - which optional services to compose, and the preset the roster resolves.
 * @returns the captured create options and the mounted preset ids.
 */
function harness(options: {
  defaultModel?: { provider: string; model: string }
  presets?: { id: string }
} = {}): { ctx: Context; captured: Captured; mounted: string[] } {
  const captured: Captured = {}
  const mounted: string[] = []
  const ctx = new Context()
  if (options.defaultModel !== undefined) {
    ctx.provide('agentDefaultModel', { currentSelection: () => options.defaultModel } as never)
  }
  if (options.presets !== undefined) {
    ctx.provide('agentPresets', {
      resolve: async (id: string | undefined) => ({ id: id ?? options.presets!.id }),
      mount: async (_ctx: Context, id: string) => { mounted.push(id) },
    } as never)
  }
  ctx.provide('agents', {
    create: async (opts: Captured) => {
      Object.assign(captured, opts)
      // The loop invokes setup before publication; a setup that throws must
      // surface here rather than in production.
      if (typeof opts.setup === 'function') await (opts.setup as (c: Context, a: unknown) => Promise<void>)(ctx, {})
      return { agent: { id: 'session-created' } }
    },
  } as never)
  return { ctx, captured, mounted }
}

describe('session creation for a new checkout', () => {
  it('creates the session in the checkout and returns its id', async () => {
    const { ctx, captured } = harness({ defaultModel: { provider: 'p', model: 'm' }, presets: { id: 'standard' } })
    const sessionId = await startSessionIn(ctx, 'C:/repo-wt', undefined)
    expect(sessionId).toBe('session-created')
    // Every consumer of a session's workspace reads this header field.
    expect(captured.meta?.cwd).toBe('C:/repo-wt')
  })

  it('passes the deployment default model, without which the agent cannot run', async () => {
    const { ctx, captured } = harness({ defaultModel: { provider: 'deepseek', model: 'chat' }, presets: { id: 'standard' } })
    await startSessionIn(ctx, '/repo', undefined)
    expect(captured.agentOptions).toEqual({ provider: 'deepseek', model: 'chat' })
  })

  it('mounts the resolved preset and records it on the header', async () => {
    const { ctx, captured, mounted } = harness({ presets: { id: 'standard' } })
    await startSessionIn(ctx, '/repo', undefined)
    expect(mounted).toEqual(['standard'])
    expect(captured.meta?.agentPreset).toBe('standard')
  })

  it('records the preset a caller requested, resolved against the roster', async () => {
    const { ctx, captured, mounted } = harness({ presets: { id: 'default-preset' } })
    await startSessionIn(ctx, '/repo', 'cordis')
    expect(mounted).toEqual(['cordis'])
    expect(captured.meta?.agentPreset).toBe('cordis')
  })

  it('composes without a model or preset registry rather than failing', async () => {
    const { ctx, captured } = harness()
    await expect(startSessionIn(ctx, '/repo', undefined)).resolves.toBe('session-created')
    expect(captured.agentOptions).toEqual({})
    expect(captured.meta?.agentPreset).toBeUndefined()
    expect(typeof captured.setup).toBe('function')
  })

  it('propagates a refusing registry so the caller can roll the checkout back', async () => {
    const ctx = new Context()
    ctx.provide('agents', {
      create: async () => { throw new Error('agent registry refused') },
    } as never)
    await expect(startSessionIn(ctx, '/repo', undefined)).rejects.toThrow(/agent registry refused/)
  })
})
