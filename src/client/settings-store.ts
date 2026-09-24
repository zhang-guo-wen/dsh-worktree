/**
 * The worktree settings page's staged form.
 *
 * The page edits the live policy of the entry that runs this plugin, so the
 * Host's own document is the single source of truth: a draft is staged here and
 * written only by the form's save. Values the Host would reject never leave the
 * page — a picker can only stage a value its field accepts, and a number that
 * is not a number blocks the save instead of being silently dropped.
 * @module @guowenzhang/dsh-worktree/client/settings-store
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions,
  type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NESTED_REPOSITORY_POLICIES, WORKTREE_LAYOUTS } from '../policy.ts'

/**
 * The fields this page edits. Every one is a live policy field of the Host
 * entry; the rest of the entry's configuration (tool names, whether the route
 * mounts, the agent subdirectory, the git bound) is composition, edited in the
 * deployment's own patch.
 */
export interface WorktreeSettings {
  /** Which nested repositories come with a checkout. */
  nestedRepositories?: string
  /** Where a checkout created without an explicit path goes. */
  defaultPath?: string
  /** Directory levels searched for nested repositories. */
  nestedScanDepth?: number
}

/** What the worktree settings page renders. */
export interface WorktreeSettingsState extends SettingsFormShell {
  /** Which nested repositories come with a checkout. */
  nestedRepositories: SettingsFieldState
  /** Where a checkout created without an explicit path goes. */
  defaultPath: SettingsFieldState
  /** Directory levels searched for nested repositories. */
  nestedScanDepth: SettingsFieldState
}

/** The registration-side face the page's slot entry injects. */
export interface WorktreeSettingsFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useWorktreeSettings. */
    worktreeSettings: SnapshotStore<WorktreeSettingsState>
  }
}

/**
 * A field restricted to a closed set of values.
 *
 * The shared text field would let a user type a policy the Host schema rejects;
 * this stages only a member of the set, and a draft outside it blocks the save
 * the way any other unaccepted draft does. An empty section reads as empty
 * rather than as a member nobody chose.
 * @param field - field name inside the namespace section.
 * @param allowed - the values the Host accepts for it.
 * @returns the field's conversion spec.
 */
function settingsChoiceField(field: string, allowed: readonly string[]): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' && allowed.includes(value) ? value : '',
    parse: text => allowed.includes(text) ? { kind: 'set', value: text } : undefined,
  }
}

/** Bridges the Host entry's live form onto the page's staged form. */
export class WorktreeSettingsController {
  private readonly form: SettingsFormModel<WorktreeSettings>
  private readonly store: SnapshotStore<WorktreeSettingsState>

  /** @param scope - the shared configuration form of the entry running this plugin. */
  constructor(scope: SettingsFormScope<WorktreeSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsChoiceField('nestedRepositories', NESTED_REPOSITORY_POLICIES),
      settingsChoiceField('defaultPath', WORKTREE_LAYOUTS),
      settingsNumberField('nestedScanDepth'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WorktreeSettingsState {
    return {
      ...this.form.shell(),
      nestedRepositories: this.form.field('nestedRepositories'),
      defaultPath: this.form.field('defaultPath'),
      nestedScanDepth: this.form.field('nestedScanDepth'),
    }
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): WorktreeSettingsFace {
    return { hooks: { worktreeSettings: this.store }, ...this.form.actions() }
  }

  /** Release the form subscription. */
  dispose(): void { this.form.dispose() }
}
