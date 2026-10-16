/**
 * Worktree surface, browser half.
 *
 * Registers the `worktree` dictionaries, one chip on the new-session screen,
 * the file-backup page in the right sidebar, and the settings page that owns
 * this plugin's policy. The chip stages "start this session inside a new
 * worktree"; the Host route it calls creates the checkout, registers its
 * project, and starts the session there as one operation. The settings page
 * edits the live policy that creation runs under, so what a deployment decides
 * in its profile the user can change per machine without restarting the Host.
 *
 * The backup page is a right-Sidebar tab type whose body lists the copies the
 * Host's file guard took before this session changed a file, each with a
 * restore control; the same settings page's `backupSidebar` switch decides
 * whether that type is registered at all.
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
// The settings form's scope type, shared with the page controller below.
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import { PluginArtworkLoop } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the locale service merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the slot registry Context merge (ctx.slots) and slot types.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings domain's Context merge (ctx.configForms) and the
// Settings section slot types.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the right Sidebar's Context merge (ctx.sidebarRightTabs) and the
// tab-type contract the backup page registers through.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: the Workspace UI service merge (ctx.uiWorkspace).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the Client sessions service face (ctx.sessions).
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the Client Workspaces service face (ctx.workspaces).
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the ui-conversation SlotMap merge (the hero controls).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-layout SlotMap merge (`shell.overlay`).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WorktreeChip } from './WorktreeChip.tsx'
import type { WorktreeChipInjected } from './WorktreeChip.tsx'
import { CheckoutNoticeToast, observeCheckouts } from './checkout-notice.tsx'
import type { CheckoutNotice, CheckoutNoticeInjected } from './checkout-notice.tsx'
import { BackupPanel } from './BackupPanel.tsx'
import type { BackupPanelInjected } from './BackupPanel.tsx'
import { request, type BackupListResult, type CheckoutProbeResult, type RestoreResult } from './api.ts'
import { WorktreeSeatController } from './seat-store.ts'
import { openWithDraft } from './draft-transfer.ts'
import { WorktreeSettingsSection } from './SettingsSection.tsx'
import { WorktreeSettingsController, type WorktreeSettings } from './settings-store.ts'
import { SETTINGS_NAMESPACE } from '../policy.ts'
import { en, NS, zh, type WorktreeCopyKey } from './locales.ts'

export type { WorktreeChipProps, WorktreeChipInjected } from './WorktreeChip.tsx'
export type { WorktreeSettingsSectionProps } from './SettingsSection.tsx'
export type { BackupPanelProps, BackupPanelInjected } from './BackupPanel.tsx'
export type { BackupEntry, BackupListResult, RestoreResult } from './api.ts'
export type { WorktreeSettings, WorktreeSettingsFace, WorktreeSettingsState } from './settings-store.ts'
export type { WorktreeSeatState } from './seat-store.ts'
export type { CheckoutNotice, CheckoutNoticeProps, CheckoutProbe, CheckoutNoticeInjected } from './checkout-notice.tsx'
export { observeCheckouts } from './checkout-notice.tsx'
export { NS } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's worktree copy. */
    worktree: WorktreeCopyKey
  }
}

/** This implementation's identity in the right Sidebar's tab system. */
const BACKUP_TAB_ID = '@guowenzhang/dsh-worktree/backup'

/** The tab kind the file-backup page is opened as. */
const BACKUP_TAB_KIND = 'worktree-backup'

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
  // whose writes nothing would accept. The scope is named rather than passed
  // inline: the seat below reads the same live document, so both surfaces
  // answer from one subscription.
  const settingsScope: SettingsFormScope<WorktreeSettings> = ctx.configForms.get(SETTINGS_NAMESPACE)
  const settings = new WorktreeSettingsController(settingsScope)
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

  // The file-backup page, as a right-Sidebar tab type and the body under it.
  //
  // The settings switch decides whether the TYPE exists at all: off, nothing
  // registers, so the page has no entry on the sidebar's guide page and no tab
  // can be opened for it — the sidebar keeps only the pages the user chose. The
  // body stays registered either way, because a session log can still carry a
  // tab whose type is gone, and the sidebar's own "nothing here can view this"
  // notice is a better answer there than a body mounting without its type.
  const backupFace: BackupPanelInjected = {
    list: sessionId => request<BackupListResult>('backups', { sessionId }),
    restore: (sessionId, relative) => request<RestoreResult>('restore', { sessionId, relative }),
  }
  ctx.inject(['slots', 'sidebarRightTabs'], (scope: Context) => {
    const tabs = scope.sidebarRightTabs
    const definition: SidebarRightTabDefinition = {
      id: BACKUP_TAB_ID,
      kind: BACKUP_TAB_KIND,
      title: () => t('sidebar.title'),
      guide: [{
        id: 'backup',
        // After the shipped pages (terminal 20), so the vendor pages keep the
        // guide's own order and this one lands with the rest of the plugins.
        order: 40,
        title: () => t('sidebar.title'),
        description: () => t('sidebar.description'),
        icon: PluginArtworkLoop,
      }],
    }
    // Read live, not captured: the settings page edits this while the sidebar
    // runs. An absent value is the schema's default, which is on.
    const offered = (): boolean => settingsScope.getSnapshot().value?.backupSidebar !== false
    scope.effect(() => {
      let registration: (() => void) | undefined
      const sync = (): void => {
        if (offered() === (registration !== undefined)) return
        if (offered()) registration = tabs.register(definition)
        else {
          registration?.()
          registration = undefined
        }
      }
      const unsubscribe = settingsScope.subscribe(sync)
      sync()
      return () => {
        unsubscribe()
        registration?.()
        registration = undefined
      }
    }, 'ui-worktree: file backup sidebar type')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register(
      { name: 'sidebar.right.pane.tab', key: BACKUP_TAB_ID, locale: NS, inject: () => backupFace },
      BackupPanel,
    )), 'ui-worktree: file backup page body')
  })

  // The archive flow's second notice. It reads the Workspace list the sidebar
  // already renders, so it belongs to no Session and rides the frame-wide
  // overlay seat; a deployment without the Workspaces service simply shows no
  // second notice and keeps the archive itself (the Host still cleans up).
  const checkoutNotices = createSnapshotStore<CheckoutNotice[]>([])
  ctx.inject(['slots', 'workspaces'], (scope: Context) => {
    const workspaces = scope.get('workspaces') as IWorkspaces | undefined
    if (workspaces === undefined) return
    /**
     * Ask the Host what the archive flow did to a path whose row is gone.
     * A refusal or an unreachable route reports `unknown`, which shows nothing.
     */
    const probe = async (path: string): Promise<CheckoutProbeResult> => {
      const result = await request<CheckoutProbeResult>('checkout', { path })
      return result.ok ? result.value : { outcome: 'unknown' }
    }
    scope.effect(
      () => observeCheckouts(workspaces, probe, checkoutNotices),
      'ui-worktree: checkout notices',
    )
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay',
      id: 'worktree-checkout',
      // After any lower-order overlay entry: this notice follows an archive the
      // user just confirmed, so nothing may cover it.
      order: 100,
      locale: NS,
      inject: (): CheckoutNoticeInjected => ({
        hooks: { notices: checkoutNotices },
        probe,
        text: notice => t(notice.outcome === 'removed' ? 'checkout.removed' : 'checkout.kept', {
          path: notice.path,
          reason: notice.reason ?? '',
        }),
        dismiss: (seq: number) => {
          checkoutNotices.set(checkoutNotices.getSnapshot().filter(entry => entry.seq !== seq))
        },
      }),
    }, CheckoutNoticeToast))
  })

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

    /**
     * Whether the deployment asks for a checkout without a click.
     *
     * Read live rather than captured: the settings page edits this while the
     * plugin runs, and the next blank Session is what the new answer applies to.
     * An absent value is the schema's own default, which is off.
     * @returns true when a new Session should start in a worktree on its own.
     */
    const startsInWorktree = (): boolean =>
      settingsScope.getSnapshot().value?.newSessionWorktree === true

    /**
     * Show the Session the Host started in the new checkout, carrying the draft
     * the user had typed on the screen they are leaving.
     *
     * The Host created that Session outside this Client's Session Controller,
     * so its id is not in the catalog when the route answers, and navigation
     * refuses an identity it cannot resolve. Pulling the list first catalogues
     * it; the second pull covers the first await having joined a list read that
     * had already started before the Session existed.
     * @param sessionId - the Session the route started.
     * @param sourceId - the Session on screen when the start was asked for, so a
     * later switch during the Git run cannot move the wrong draft.
     */
    const openStarted = async (sessionId: string, sourceId: string | undefined): Promise<void> => {
      const service = sessions()
      if (service === undefined) throw new Error('worktree: sessions service unavailable')
      const catalogued = (): boolean => service.list.getSnapshot().byId[sessionId as SessionId] !== undefined
      await service.refresh()
      if (!catalogued()) await service.refresh()
      // The control is only clickable on a screen this seat probed, so a missing
      // source means there is nothing to carry rather than a reason to stay.
      if (sourceId === undefined) {
        scope.uiWorkspace.openSession(sessionId as SessionId)
        return
      }
      // The user moved to another Session while Git ran: open nothing and touch
      // no draft — the one on screen now is not the one that asked for this.
      if (shown !== sourceId) return
      openWithDraft(scope, service, sourceId as SessionId, sessionId as SessionId,
        () => { scope.uiWorkspace.openSession(sessionId as SessionId) })
    }

    /**
     * Spend the seat: start the Session in a new checkout and open it.
     *
     * The Session on screen travels with the call, so a switch during the Git
     * run cannot move the wrong draft.
     */
    const startSeat = (): void => {
      const sourceId = shown
      void controller.start(sessionId => openStarted(sessionId, sourceId))
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
      void controller.load(editableNow ? cwdOf(sessionId) : undefined).then(() => {
        // The deployment may ask for the checkout without a click. The probe has
        // answered by now, and the seat decides the rest: once per Session, and
        // only where the control is actually offered.
        if (editableNow && controller.autoStart(sessionId, startsInWorktree())) startSeat()
      })
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
        if (enabled) startSeat()
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
