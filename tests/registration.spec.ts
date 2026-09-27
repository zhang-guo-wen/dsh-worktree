/**
 * Registration contract of the browser half.
 *
 * The chip's mount point is a behavioral decision, not a detail: a `single`
 * slot renders exactly one entry (the lowest priority wins), so registering
 * into the agent-preset cell would silently replace that chip instead of
 * sitting beside it. These cases mount the real plugin on a context that
 * records slot registrations and assert which slot it chose.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/client/index.ts'
import { configFormsDouble } from './config-forms-double.ts'

/** One recorded slot registration. */
interface Recorded {
  readonly name: string
  readonly id?: string
  readonly priority?: number
}

/**
 * Mount the browser half on a context recording its slot registrations.
 * @returns the recorded registrations, and whether the injection callback ran.
 */
async function mount(): Promise<{ recorded: Recorded[]; injected: boolean; disposed: boolean }> {
  const recorded: Recorded[] = []
  const state = { injected: false, disposed: false }
  const ctx = new Context()
  ctx.provide('locale', {
    register: () => () => {},
    bind: () => (key: string) => key,
  } as never)
  const slotEntry = {
    inject(_name: string, callback: () => unknown) {
      state.injected = true
      callback()
      return () => { state.disposed = true }
    },
    register(options: Recorded) {
      recorded.push(options)
      return () => {}
    },
  }
  const scope = {
    slots: slotEntry,
    get: () => undefined,
    effect: (fn: () => unknown) => { fn() },
  }
  ctx.provide('slots', slotEntry as never)
  ctx.provide('conversation', {} as never)
  ctx.provide('uiWorkspace', {} as never)
  // Not served: this case asserts the chip's registration, so the settings page
  // stays unregistered while the double reports no entry.
  ctx.provide('configForms', configFormsDouble().service as never)
  // `ctx.inject(deps, cb)` only runs cb once every dep resolves; providing all
  // four makes the callback run against the recorded scope instead.
  const originalInject = ctx.inject.bind(ctx)
  ctx.inject = ((_deps: unknown, cb: (s: unknown) => unknown) => {
    cb(scope)
    return undefined
  }) as typeof ctx.inject
  void originalInject
  await ctx.plugin(plugin, {}).await()
  return { recorded, ...state }
}

describe('browser half registration', () => {
  it('registers into a list slot, where entries render alongside each other', async () => {
    const { recorded, injected } = await mount()
    expect(injected).toBe(true)
    expect(recorded).toHaveLength(1)
    // `conversation.input.dock` is declared `kind: 'list'`; every hero slot is
    // `kind: 'single'`, which holds one occupant and would shadow instead.
    expect(recorded[0]!.name).toBe('conversation.input.dock')
    expect(recorded[0]!.id).toBe('worktree')
  })

  it('does not register into a single-kind hero slot', async () => {
    const { recorded } = await mount()
    for (const entry of recorded) {
      expect(entry.name).not.toMatch(/^conversation\.hero\./)
    }
  })

  it('registers the dictionaries under its own namespace', async () => {
    expect(plugin.NS).toBe('worktree')
  })
})
