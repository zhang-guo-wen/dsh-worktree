/**
 * Worktree surface, browser half.
 *
 * Registers the `worktree` dictionaries, one chip on the new-session screen,
 * and the settings page that owns this plugin's policy. The chip stages "start
 * this session inside a new worktree"; the Host route it calls creates the
 * checkout, registers its project, and starts the session there as one
 * operation. The settings page edits the live policy that creation runs under,
 * so what a deployment decides in its profile the user can change per machine
 * without restarting the Host.
 *
 * The chip is registered while a BLANK main Session is current, because a
 * Session's working directory is fixed at creation: the choice exists only
 * before the first turn, and afterwards the way to change it is a new session.
 * Registration follows the composed conversation scope, which is how the chip
 * reaches the Session it belongs to.
 * @module @guowenzhang/dsh-worktree/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale service merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry Context merge (ctx.slots) and slot types.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings domain's Context merge (ctx.configForms) and the
// Settings section slot types.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Workspace UI service merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the Client sessions service face (ctx.sessions).
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ui-conversation SlotMap merge (the hero controls).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { WorktreeChip } from './WorktreeChip.tsx'
import type { WorktreeChipInjected } from './WorktreeChip.tsx'
import { WorktreeSeatController } from './seat-store.ts'
import { WorktreeSettingsSection } from './SettingsSection.tsx'
import { WorktreeSettingsController } from './settings-store.ts'
import { SETTINGS_NAMESPACE } from '../policy.ts'
import { en, NS, zh, type WorktreeCopyKey } from './locales.ts'

export type { WorktreeChipProps, WorktreeChipInjected } from './WorktreeChip.tsx'
export type { WorktreeSettingsSectionProps } from './SettingsSection.tsx'
export type { WorktreeSettings, WorktreeSettingsFace, WorktreeSettingsState } from './settings-store.ts'
export type { WorktreeSeatState } from './seat-store.ts'
export { NS } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's worktree copy. */
    worktree: WorktreeCopyKey
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'conversation', 'uiWorkspace', 'configForms']

/**
 * Register the dictionaries, the new-session worktree chip, and the settings page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-worktree: dictionaries')
  const t = ctx.locale.bind(NS)

  // The policy page exists while the Host serves this plugin's entry, so a
  // deployment that runs the tools without a settings document shows no page
  // whose writes nothing would accept.
  const settings = new WorktreeSettingsController(ctx.configForms.get(SETTINGS_NAMESPACE))
  ctx.effect(() => () => { settings.dispose() }, 'ui-worktree: settings form subscription')
  ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'worktree',
    // After Models and Agent presets: what a checkout IS comes after what runs in it.
    order: 30,
    label: () => t('settings.nav'),
    locale: NS,
    inject: () => settings.inject(),
  }, WorktreeSettingsSection))), 'ui-worktree: settings page')

  // The conversation scope owns the Session the hero is about to hand over to,
  // so the chip and its seat live inside it and are torn down with it.
  ctx.inject(['slots', 'conversation', 'sessions', 'uiWorkspace'], (scope: Context) => {
    const controller = new WorktreeSeatController()
    /** Whether this surface may still choose: a blank Session is on screen. */
    const editable = createSnapshotStore(false)
    /** Catalog subscription for the Session on screen; replaced by each load. */
    let gate: (() => void) | undefined
    scope.effect(() => () => { gate?.() }, 'ui-worktree: session gate')
    /** The Session the seat currently describes, so a switch resets it. */
    let shown: string | undefined

    const sessions = (): ISessions | undefined => scope.get('sessions') as ISessions | undefined
    const cwdOf = (sessionId: string): string | undefined =>
      sessions()?.list.getSnapshot().byId[sessionId as SessionId]?.cwd

    /**
     * Whether one Session may still choose where it runs.
     *
     * The dock's owner props identify the Session on screen, so this reads that
     * Session's own row rather than searching the catalog: `blank` is the
     * Client's "no turn has run yet" fact, and a Session's working directory is
     * fixed once a turn runs.
     * @param sessionId - the Session the composer belongs to.
     * @returns true when the choice is still open.
     */
    const isEditable = (sessionId: string): boolean => {
      const row = sessions()?.list.getSnapshot().byId[sessionId as SessionId]
      return row?.blank === true
    }

    const evaluate = (sessionId: string): void => {
      const editableNow = isEditable(sessionId)
      editable.set(editableNow)
      // A checkout this seat created belongs to the Session that asked for it;
      // arriving at another Session must not be answered with that Session.
      if (sessionId !== shown) {
        shown = sessionId
        controller.resetStart()
      }
      void controller.load(editableNow ? cwdOf(sessionId) : undefined)
    }

    /**
     * Show the Session the Host started in the new checkout.
     *
     * The Host created that Session outside this Client's Session Controller,
     * so its id is not in the catalog when the route answers, and navigation
     * refuses an identity it cannot resolve. Pulling the list first catalogues
     * it; the second pull covers the first await having joined a list read that
     * had already started before the Session existed.
     * @param sessionId - the Session the route started.
     */
    const openStarted = async (sessionId: string): Promise<void> => {
      const service = sessions()
      if (service === undefined) return
      const catalogued = (): boolean => service.list.getSnapshot().byId[sessionId as SessionId] !== undefined
      await service.refresh()
      if (!catalogued()) await service.refresh()
      scope.uiWorkspace.openSession(sessionId as SessionId)
    }

    const injected = (): WorktreeChipInjected => ({
      hooks: { worktreeSeat: controller.store, editable },
      load: async (sessionId: string) => {
        evaluate(sessionId)
        const list = sessions()?.list
        if (list === undefined) return
        // Re-probe on every catalog change: the first turn closes the choice,
        // and the chip must stop offering it then rather than at a remount.
        // One gate belongs to the Session on screen — a subscription left
        // behind by a previous Session would re-publish that Session's
        // directory and branch on every catalog change.
        gate?.()
        gate = list.subscribe(() => { evaluate(sessionId) })
      },
      loadBranches: () => controller.loadBranches(),
      selectBase: (base: string) => { controller.selectBase(base) },
      setEnabled: (enabled: boolean) => {
        controller.setEnabled(enabled)
        // Checking the control is the whole action: it starts the session
        // immediately, because the alternative is a second button on a row that
        // has room for one control.
        if (enabled) void controller.start(openStarted)
      },
    })

    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'worktree',
      // Above the queue and todo docks: choosing where the session runs
      // precedes watching what it runs.
      order: -10,
      locale: NS,
      inject: injected,
    }, WorktreeChip))
  })
}
