/**
 * The worktree settings page's contract.
 *
 * The page is the only surface that edits this plugin's live policy, so two
 * things must hold: it exists exactly while the Host serves the entry, and a
 * save writes what the user staged and nothing else. The double stands in for
 * the settings transport so both are asserted without a running Host.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/client/index.ts'
import type { WorktreeSettingsFace } from '../src/client/settings-store.ts'
import { configFormsDouble, type ConfigFormsDouble } from './config-forms-double.ts'

/** One recorded slot registration. */
interface Recorded {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly inject?: () => WorktreeSettingsFace
}

/** What one mounted browser half exposes to a case. */
interface Mounted {
  /** Registrations the plugin made, in order. */
  readonly recorded: Recorded[]
  /** Config-forms double the page was built over. */
  readonly forms: ConfigFormsDouble
}

/**
 * Mount the browser half over a double for the settings entry.
 * @param options - whether the Host serves the entry, and its current section and raw override layer.
 * @returns the recorded registrations and the double.
 */
async function mount(options: {
  served?: boolean
  value?: Record<string, unknown>
  user?: Record<string, unknown>
} = {}): Promise<Mounted> {
  const recorded: Recorded[] = []
  const forms = configFormsDouble({ served: options.served ?? true, value: options.value, user: options.user })
  const ctx = new Context()
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
  const slots = {
    inject: (_name: string, callback: () => unknown) => { callback(); return () => {} },
    register: (entry: Recorded) => { recorded.push(entry); return () => {} },
  }
  ctx.provide('slots', slots as never)
  ctx.provide('conversation', {} as never)
  ctx.provide('uiWorkspace', {} as never)
  ctx.provide('configForms', forms.service as never)
  ctx.inject = ((_deps: unknown, callback: (scope: unknown) => unknown) => {
    callback({ slots, get: () => undefined, effect: (fn: () => unknown) => { fn() } })
    return undefined
  }) as typeof ctx.inject
  await ctx.plugin(plugin, {}).await()
  return { recorded, forms }
}

/** The settings page's registration, which is the one carrying an inject face. */
function page(mounted: Mounted): Recorded {
  const entry = mounted.recorded.find(candidate => candidate.name === 'settings.section')
  if (entry === undefined) throw new Error('the browser half registered no settings page')
  return entry
}

describe('worktree settings page', () => {
  it('registers one page into the settings section, keyed by its own namespace', async () => {
    const mounted = await mount()
    const entry = page(mounted)
    expect(entry.id).toBe('worktree')
    expect(entry.order).toBe(30)
    // The page follows the namespace the Host serves, never a hardcoded list.
    expect(mounted.forms.watched).toEqual([['worktree']])
    expect(page(mounted).inject).toBeTypeOf('function')
  })

  it('projects the served entry into the fields it edits', async () => {
    const mounted = await mount({
      value: { nestedRepositories: 'all', defaultPath: 'home', nestedScanDepth: 2 },
      user: { nestedRepositories: 'all' },
    })
    const face = page(mounted).inject?.()
    const state = face?.hooks.worktreeSettings.getSnapshot()
    expect(state?.available).toBe(true)
    expect(state?.nestedRepositories).toMatchObject({ text: 'all', overridden: true, invalid: false })
    expect(state?.defaultPath).toMatchObject({ text: 'home', overridden: false })
    expect(state?.nestedScanDepth.text).toBe('2')
  })

  it('saves the staged policy as one revision-fenced write', async () => {
    const mounted = await mount({ value: { nestedRepositories: 'submodules' } })
    const face = page(mounted).inject?.()
    face?.edit('nestedRepositories', 'all')
    expect(face?.hooks.worktreeSettings.getSnapshot().dirty).toBe(true)
    face?.save()
    await Promise.resolve()
    await Promise.resolve()
    expect(mounted.forms.mutations).toEqual([
      { ops: [{ op: 'set', path: ['nestedRepositories'], value: 'all' }], expectedRevision: 1 },
    ])
  })

  it('stages nothing for a value the Host would reject', async () => {
    const mounted = await mount({ value: { nestedRepositories: 'all' } })
    const face = page(mounted).inject?.()
    // A picker can only offer the closed set, so this is the guard that keeps a
    // hand-edited value from reaching the document.
    face?.edit('nestedRepositories', 'everything')
    expect(face?.hooks.worktreeSettings.getSnapshot().nestedRepositories.invalid).toBe(true)
    face?.save()
    await Promise.resolve()
    expect(mounted.forms.mutations).toEqual([])
  })

  it('clears a field back to the composition layer', async () => {
    const mounted = await mount({ value: { defaultPath: 'sibling' }, user: { defaultPath: 'sibling' } })
    const face = page(mounted).inject?.()
    face?.resetField('defaultPath')
    face?.save()
    await Promise.resolve()
    await Promise.resolve()
    expect(mounted.forms.mutations).toEqual([
      { ops: [{ op: 'unset', path: ['defaultPath'] }], expectedRevision: 1 },
    ])
  })

  it('registers no page while the Host does not serve the entry', async () => {
    const mounted = await mount({ served: false })
    expect(mounted.recorded.some(entry => entry.name === 'settings.section')).toBe(false)
    expect(mounted.forms.watched).toEqual([['worktree']])
  })
})
