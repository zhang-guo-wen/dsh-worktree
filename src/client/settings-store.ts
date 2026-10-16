/**
 * Automatically persist the worktree policy through the Host's shared settings
 * scope. Writes are serialized; drafts typed while a write is in flight stay
 * visible and are sent next, rather than being cleared by the older response.
 * @module @guowenzhang/dsh-worktree/client/settings-store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  SettingsFieldState, SettingsFormScope, SettingsFormShell, SettingsFormPathOp,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  formatSetting, parseSetting, WORKTREE_SETTINGS_FIELDS, type WorktreeSettingsField,
} from './settings-fields.ts'

/** The live policy fields exposed by this page. */
export interface WorktreeSettings {
  newSessionWorktree?: boolean
  nestedRepositories?: string
  defaultPath?: string
  nestedScanDepth?: number
  fileGuard?: boolean
  denyDestructiveCommands?: boolean
}

/** What the worktree settings page renders. */
export interface WorktreeSettingsState extends SettingsFormShell {
  /**
   * How many writes the Host has refused. A refused field stays failed until a
   * later write for it is accepted, so the boolean alone cannot tell the page
   * that a second edit was refused too; the count reports every one of them.
   */
  failedSeq: number
  newSessionWorktree: SettingsFieldState
  nestedRepositories: SettingsFieldState
  defaultPath: SettingsFieldState
  nestedScanDepth: SettingsFieldState
  fileGuard: SettingsFieldState
  denyDestructiveCommands: SettingsFieldState
}

/** Only edits are exposed: this page has no manual save or reset workflow. */
export interface WorktreeSettingsFace {
  hooks: { worktreeSettings: SnapshotStore<WorktreeSettingsState> }
  edit: (field: string, text: string) => void
}

type Field = WorktreeSettingsField

/** Bridges automatic, revision-fenced writes onto the Host's live policy. */
export class WorktreeSettingsController {
  private readonly store: SnapshotStore<WorktreeSettingsState>
  private readonly drafts = new Map<Field, string>()
  private readonly pending = new Map<Field, string>()
  private readonly unsubscribe: () => void
  private saving = false
  private readonly failedFields = new Set<Field>()
  private failedWrites = 0
  private disposed = false

  constructor(private readonly scope: SettingsFormScope<WorktreeSettings>) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => { this.publish() })
  }

  /**
   * One field as its control renders it.
   * @param field - the field being read.
   * @returns the control's staged state.
   */
  private field(field: Field): SettingsFieldState {
    const snapshot = this.scope.getSnapshot()
    const draft = this.drafts.get(field)
    const value = snapshot.value?.[field]
    return {
      text: draft !== undefined ? draft : formatSetting(field, value),
      overridden: draft !== undefined || Object.hasOwn(snapshot.user ?? {}, field),
      invalid: draft !== undefined && parseSetting(field, draft) === undefined,
    }
  }

  private projection(): WorktreeSettingsState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.drafts.size > 0,
      invalid: [...this.drafts].some(([field, text]) => parseSetting(field, text) === undefined),
      saving: this.saving,
      failed: this.failedFields.size > 0,
      failedSeq: this.failedWrites,
      newSessionWorktree: this.field('newSessionWorktree'),
      nestedRepositories: this.field('nestedRepositories'),
      defaultPath: this.field('defaultPath'),
      nestedScanDepth: this.field('nestedScanDepth'),
      fileGuard: this.field('fileGuard'),
      denyDestructiveCommands: this.field('denyDestructiveCommands'),
    }
  }

  inject(): WorktreeSettingsFace {
    return {
      hooks: { worktreeSettings: this.store },
      edit: (field, text) => { this.edit(field, text) },
    }
  }

  private edit(name: string, text: string): void {
    if (!WORKTREE_SETTINGS_FIELDS.includes(name as WorktreeSettingsField)) {
      throw new Error(`unknown worktree setting ${name}`)
    }
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable) return
    const field = name as Field
    if (!this.saving && !this.drafts.has(field) && this.field(field).text === text) return
    this.drafts.set(field, text)
    if (parseSetting(field, text) === undefined) this.pending.delete(field)
    else this.pending.set(field, text)
    this.publish()
    void this.flush()
  }

  private async flush(): Promise<void> {
    if (this.saving || this.disposed) return
    this.saving = true
    try {
      while (this.pending.size > 0 && !this.disposed) {
        const snapshot = this.scope.getSnapshot()
        if (snapshot.status !== 'ready' || !snapshot.writable) break
        const batch = new Map(this.pending)
        this.pending.clear()
        const ops: SettingsFormPathOp[] = [...batch].map(([field, text]) => ({
          op: 'set', path: [field], value: parseSetting(field, text),
        }))
        this.publish()
        let accepted = false
        try { accepted = await this.scope.mutate(ops, snapshot.revision) } catch { /* Keep drafts and show the failure. */ }
        if (this.disposed) return
        if (accepted) {
          for (const [field, text] of batch) {
            this.failedFields.delete(field)
            if (this.drafts.get(field) === text && !this.pending.has(field)) this.drafts.delete(field)
          }
        } else {
          this.failedWrites += 1
          for (const field of batch.keys()) this.failedFields.add(field)
        }
        // Only newer edits are sent again. A refused batch never retries in a
        // loop; the next user edit can correct or retry it at the latest revision.
      }
    } finally {
      this.saving = false
      this.publish()
    }
  }

  private publish(): void {
    if (!this.disposed) this.store.set(this.projection())
  }

  /** Stop subscriptions and unsent writes when the plugin is unloaded. */
  dispose(): void {
    this.disposed = true
    this.pending.clear()
    this.unsubscribe()
  }
}
