/**
 * Registration contract of the browser half.
 *
 * The chip's mount point is a behavioral decision, not a detail: a `single`
 * slot renders exactly one entry (the lowest priority wins), so registering
 * into the agent-preset cell would silently replace that chip instead of
 * sitting beside it. These cases mount the real plugin on a context that
 * records slot registrations and assert which slot it chose, and which tab type
 * the settings switch allows the right sidebar to offer.
 */

import { Context } from '@deepseek-ai/cordis'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/client/index.ts'
import { configFormsDouble } from './config-forms-double.ts'

/** One recorded slot registration. */
interface Recorded {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly priority?: number
}

/** What one mounted browser half exposes to a case. */
interface Mounted {
  /** Registrations the plugin made, in order. */
  readonly recorded: Recorded[]
  /** Tab types registered with the right Sidebar, in order. */
  readonly tabs: SidebarRightTabDefinition[]
  /** The settings double the switch is read from. */
  readonly forms: ReturnType<typeof configFormsDouble>
  /** Whether the injection callback ran. */
  readonly injected: boolean
  /** Whether the injection scope was disposed. */
  readonly disposed: boolean
}

/**
 * Mount the browser half on a context recording its slot registrations.
 * @param options.value - the resolved section the sidebar switch reads.
 * @returns the recorded registrations and the doubles they ran against.
 */
async function mount(options: { value?: Record<string, unknown> } = {}): Promise<Mounted> {
  const recorded: Recorded[] = []
  const tabs: SidebarRightTabDefinition[] = []
  const state = { injected: false, disposed: false }
  const forms = configFormsDouble(options.value === undefined ? {} : { value: options.value })
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
  // The right Sidebar's tab-type registry, as an outside plugin sees it: a
  // registration is the type's whole life, and the disposer ends it.
  const tabRegistry = {
    register(definition: SidebarRightTabDefinition) {
      tabs.push(definition)
      return () => { tabs.splice(tabs.indexOf(definition), 1) }
    },
    subscribe: () => () => {},
  }
  const scope = {
    slots: slotEntry,
    sidebarRightTabs: tabRegistry,
    get: () => undefined,
    effect: (fn: () => unknown) => { fn() },
  }
  ctx.provide('slots', slotEntry as never)
  ctx.provide('conversation', {} as never)
  ctx.provide('uiWorkspace', {} as never)
  // Not served: this case asserts the chip's registration, so the settings page
  // stays unregistered while the double reports no entry.
  ctx.provide('configForms', forms.service as never)
  // `ctx.inject(deps, cb)` only runs cb once every dep resolves; providing all
  // of them makes the callback run against the recorded scope instead.
  ctx.inject = ((_deps: unknown, cb: (s: unknown) => unknown) => {
    cb(scope)
    return undefined
  }) as typeof ctx.inject
  await ctx.plugin(plugin, {}).await()
  return { recorded, tabs, forms, ...state }
}

/** The chip's registration, which is the one the hero row renders. */
function chip(mounted: Mounted): Recorded | undefined {
  return mounted.recorded.find(entry => entry.name === 'conversation.input.dock')
}

/** The file-backup page's body registration. */
function backupPage(mounted: Mounted): Recorded | undefined {
  return mounted.recorded.find(entry => entry.name === 'sidebar.right.pane.tab')
}

describe('browser half registration', () => {
  it('registers into a list slot, where entries render alongside each other', async () => {
    const mounted = await mount()
    expect(mounted.injected).toBe(true)
    // `conversation.input.dock` is declared `kind: 'list'`; every hero slot is
    // `kind: 'single'`, which holds one occupant and would shadow instead.
    expect(chip(mounted)?.id).toBe('worktree')
  })

  it('does not register into a single-kind hero slot', async () => {
    const mounted = await mount()
    for (const entry of mounted.recorded) {
      expect(entry.name).not.toMatch(/^conversation\.hero\./)
    }
  })

  it('registers the dictionaries under its own namespace', () => {
    expect(plugin.NS).toBe('worktree')
  })
})

describe('the file-backup sidebar page', () => {
  it('registers its body under the tab type it also registers, with a guide entry', async () => {
    const mounted = await mount()

    expect(mounted.tabs).toHaveLength(1)
    const definition = mounted.tabs[0]!
    expect(definition.kind).toBe('worktree-backup')
    expect(definition.patterns).toBeUndefined()
    expect(definition.guide?.[0]?.id).toBe('backup')
    // The body is keyed by the type's own id: the seat dispatches a tab through
    // the definition it found, so the two must agree or nothing renders.
    expect(backupPage(mounted)?.key).toBe(definition.id)
  })

  it('registers no page while the settings switch is off', async () => {
    const mounted = await mount({ value: { backupSidebar: false } })

    expect(mounted.tabs).toEqual([])
    // The body stays registered: a session log can still carry a tab whose type
    // is gone, and the sidebar's own notice is a better answer than a mount
    // with nothing to dispatch to.
    expect(backupPage(mounted)).toBeDefined()
  })

  it('adds and removes the page as the switch is edited', async () => {
    const mounted = await mount({ value: { backupSidebar: false } })
    expect(mounted.tabs).toEqual([])

    mounted.forms.setValue({ backupSidebar: true })
    expect(mounted.tabs.map(definition => definition.kind)).toEqual(['worktree-backup'])

    mounted.forms.setValue({ backupSidebar: false })
    expect(mounted.tabs).toEqual([])
  })

  it('offers the page by default, when nothing stores the switch', async () => {
    const mounted = await mount()
    expect(mounted.tabs).toHaveLength(1)
  })
})
