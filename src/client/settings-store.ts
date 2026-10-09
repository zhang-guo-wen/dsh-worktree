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
import { NESTED_REPOSITORY_POLICIES, WORKTREE_LAYOUTS } from '../policy.ts'

/** The live policy fields exposed by this page. */
export interface WorktreeSettings {
  nestedRepositories?: string
  defaultPath?: string
  nestedScanDepth?: number
}

/** What the worktree settings page renders. */
export interface WorktreeSettingsState extends SettingsFormShell {
  nestedRepositories: SettingsFieldState
  defaultPath: SettingsFieldState
  nestedScanDepth: SettingsFieldState
}

/** Only edits are exposed: this page has no manual save or reset workflow. */
export interface WorktreeSettingsFace {
  hooks: { worktreeSettings: SnapshotStore<WorktreeSettingsState> }
  edit: (field: string, text: string) => void
}

const fields = ['nestedRepositories', 'defaultPath', 'nestedScanDepth'] as const
type Field = typeof fields[number]

function parse(field: Field, text: string): string | number | undefined {
  if (field === 'nestedRepositories') return NESTED_REPOSITORY_POLICIES.includes(text as never) ? text : undefined
  if (field === 'defaultPath') return WORKTREE_LAYOUTS.includes(text as never) ? text : undefined
  const number = Number(text)
  return text.trim() !== '' && Number.isSafeInteger(number) && number > 0 ? number : undefined
}

/** Bridges automatic, revision-fenced writes onto the Host's live policy. */
export class WorktreeSettingsController {
  private readonly store: SnapshotStore<WorktreeSettingsState>
  private readonly drafts = new Map<Field, string>()
  private readonly pending = new Map<Field, string>()
  private readonly unsubscribe: () => void
  private saving = false
  private readonly failedFields = new Set<Field>()
  private disposed = false

  constructor(private readonly scope: SettingsFormScope<WorktreeSettings>) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => { this.publish() })
  }

  private field(field: Field): SettingsFieldState {
    const snapshot = this.scope.getSnapshot()
    const draft = this.drafts.get(field)
    const value = snapshot.value?.[field]
    return {
      text: draft ?? (value === undefined ? '' : String(value)),
      overridden: draft !== undefined || Object.hasOwn(snapshot.user ?? {}, field),
      invalid: draft !== undefined && parse(field, draft) === undefined,
    }
  }

  private projection(): WorktreeSettingsState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.drafts.size > 0,
      invalid: [...this.drafts].some(([field, text]) => parse(field, text) === undefined),
      saving: this.saving,
      failed: this.failedFields.size > 0,
      nestedRepositories: this.field('nestedRepositories'),
      defaultPath: this.field('defaultPath'),
      nestedScanDepth: this.field('nestedScanDepth'),
    }
  }

  inject(): WorktreeSettingsFace {
    return {
      hooks: { worktreeSettings: this.store },
      edit: (field, text) => { this.edit(field, text) },
    }
  }

  private edit(name: string, text: string): void {
    if (!fields.includes(name as Field)) throw new Error(`unknown worktree setting ${name}`)
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable) return
    const field = name as Field
    if (!this.saving && !this.drafts.has(field) && this.field(field).text === text) return
    this.drafts.set(field, text)
    if (parse(field, text) === undefined) this.pending.delete(field)
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
          op: 'set', path: [field], value: parse(field, text),
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
