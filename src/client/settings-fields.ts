/**
 * The settings page's field vocabulary: which policy fields it edits, and how
 * each one converts between its stored value and the text its control renders.
 *
 * This sits apart from `settings-store.ts` on purpose. The store subscribes to
 * the Host's settings scope, which carries a runtime dependency the self-contained
 * spec runner cannot resolve; the conversion rules carry none, so keeping them
 * here is what lets them be exercised without a composed Host. The same
 * reasoning as `policy.ts`, which the browser bundle also imports directly.
 *
 * @module @guowenzhang/dsh-worktree/client/settings-fields
 */

import {
  DEFAULT_BACKUP_SIDEBAR, DEFAULT_DENY_DESTRUCTIVE_COMMANDS, DEFAULT_FILE_GUARD, DEFAULT_NEW_SESSION_WORKTREE,
  NESTED_REPOSITORY_POLICIES, WORKTREE_LAYOUTS,
} from '../policy.ts'

/**
 * Every switch field, with the schema default an absent value resolves to.
 *
 * Three of the four default to `true` and one to `false`, so a single
 * `SWITCH_DEFAULT` would have to lie about somebody. These entries must move
 * with the `DEFAULT_*` constants in `policy.ts`: a page that renders "on" for a
 * switch that is off has the user "fix" a setting that was already correct,
 * which is worse than showing nothing.
 */
export const SWITCH_DEFAULTS: Readonly<Record<string, boolean>> = {
  fileGuard: DEFAULT_FILE_GUARD,
  denyDestructiveCommands: DEFAULT_DENY_DESTRUCTIVE_COMMANDS,
  newSessionWorktree: DEFAULT_NEW_SESSION_WORKTREE,
  backupSidebar: DEFAULT_BACKUP_SIDEBAR,
}

/** Every policy field the settings page edits, in the order the page renders them. */
export const WORKTREE_SETTINGS_FIELDS = [
  'newSessionWorktree', 'nestedRepositories', 'defaultPath', 'nestedScanDepth', 'fileGuard', 'denyDestructiveCommands',
  'backupSidebar',
] as const

/** One policy field the settings page edits. */
export type WorktreeSettingsField = typeof WORKTREE_SETTINGS_FIELDS[number]

/**
 * Whether a field is a switch rather than a picker, number, or string.
 * @param field - the field to test.
 * @returns true when the field's control is a switch.
 */
export function isSwitchField(field: WorktreeSettingsField): boolean {
  return Object.hasOwn(SWITCH_DEFAULTS, field)
}

/**
 * The schema default one switch resolves to when nothing is stored.
 * @param field - the switch field being read.
 * @returns the default the Host's schema would apply.
 */
function switchDefault(field: WorktreeSettingsField): boolean {
  return SWITCH_DEFAULTS[field] ?? false
}

/**
 * Render a field's stored value as the draft text its control reads.
 *
 * A picker or a number with no stored value renders as the empty string, which
 * is what "nothing chosen yet" means for those controls. A switch renders the
 * schema default instead, because for a boolean the absent value is a real
 * setting rather than an empty selection.
 * @param field - the field being rendered.
 * @param value - the section's stored value, when it carries one.
 * @returns the draft text.
 */
export function formatSetting(field: WorktreeSettingsField, value: unknown): string {
  if (isSwitchField(field)) return typeof value === 'boolean' ? String(value) : String(switchDefault(field))
  return value === undefined ? '' : String(value)
}

/**
 * Convert draft text into the value a save writes.
 *
 * The empty string is the schema default for a switch; for every other field it
 * is not a value at all, which is what makes a cleared input block the save
 * rather than writing `null`.
 * @param field - the field being written.
 * @param text - the draft text.
 * @returns the value to write, or undefined when the text is not a value this field accepts.
 */
export function parseSetting(field: WorktreeSettingsField, text: string): string | number | boolean | undefined {
  if (field === 'nestedRepositories') return NESTED_REPOSITORY_POLICIES.includes(text as never) ? text : undefined
  if (field === 'defaultPath') return WORKTREE_LAYOUTS.includes(text as never) ? text : undefined
  if (isSwitchField(field)) {
    if (text === 'true') return true
    if (text === 'false') return false
    return text === '' ? switchDefault(field) : undefined
  }
  const number = Number(text)
  return text.trim() !== '' && Number.isSafeInteger(number) && number > 0 ? number : undefined
}
