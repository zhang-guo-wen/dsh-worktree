/**
 * The settings page's field conversion, including the new-session default and
 * the file-protection switches.
 *
 * One rule decides whether these rows tell the truth: an absent section value
 * renders as the schema default, not as `false`. A switch shown off on a
 * deployment that has it on is worse than showing nothing, because the user
 * then "fixes" a setting that was already correct — and the new-session switch
 * is the mirror case, where a shared `true` would show it on.
 */

import { describe, expect, it } from 'vitest'
import {
  formatSetting, isSwitchField, parseSetting, SWITCH_DEFAULTS, WORKTREE_SETTINGS_FIELDS,
} from '../src/client/settings-fields.ts'

describe('the settings page field set', () => {
  it('edits the new-session default, the checkout policy, and the protection switches', () => {
    expect(WORKTREE_SETTINGS_FIELDS).toEqual([
      'newSessionWorktree', 'nestedRepositories', 'defaultPath', 'nestedScanDepth', 'fileGuard', 'denyDestructiveCommands',
      'backupSidebar',
    ])
    expect(isSwitchField('newSessionWorktree')).toBe(true)
    expect(isSwitchField('fileGuard')).toBe(true)
    expect(isSwitchField('denyDestructiveCommands')).toBe(true)
    expect(isSwitchField('backupSidebar')).toBe(true)
    expect(isSwitchField('defaultPath')).toBe(false)
  })
})

describe('rendering a stored value as draft text', () => {
  it('shows each switch as its own schema default when the section carries no value', () => {
    // Three switches default to on and the new-session default to off, so the
    // defaults are per field rather than one shared constant.
    expect(SWITCH_DEFAULTS).toEqual({
      fileGuard: true, denyDestructiveCommands: true, newSessionWorktree: false, backupSidebar: true,
    })
    expect(formatSetting('fileGuard', undefined)).toBe('true')
    expect(formatSetting('denyDestructiveCommands', undefined)).toBe('true')
    expect(formatSetting('newSessionWorktree', undefined)).toBe('false')
    // The backup page is offered unless a deployment turned it off, so an
    // absent value renders as the on default the settings row reads.
    expect(formatSetting('backupSidebar', undefined)).toBe('true')
  })

  it('shows a switch as its stored value', () => {
    expect(formatSetting('fileGuard', false)).toBe('false')
    expect(formatSetting('fileGuard', true)).toBe('true')
    expect(formatSetting('newSessionWorktree', true)).toBe('true')
    expect(formatSetting('backupSidebar', false)).toBe('false')
  })

  it('shows an unchosen picker or number as empty', () => {
    expect(formatSetting('defaultPath', undefined)).toBe('')
    expect(formatSetting('nestedScanDepth', 2)).toBe('2')
  })
})

describe('converting draft text into a written value', () => {
  it('writes a boolean for a switch, never the draft text', () => {
    expect(parseSetting('fileGuard', 'false')).toBe(false)
    expect(parseSetting('denyDestructiveCommands', 'true')).toBe(true)
    expect(parseSetting('newSessionWorktree', 'true')).toBe(true)
    expect(parseSetting('backupSidebar', 'false')).toBe(false)
  })

  it('treats empty switch text as the schema default rather than off', () => {
    expect(parseSetting('fileGuard', '')).toBe(true)
    expect(parseSetting('newSessionWorktree', '')).toBe(false)
    expect(parseSetting('backupSidebar', '')).toBe(true)
  })

  it('refuses switch text that names neither state', () => {
    expect(parseSetting('fileGuard', 'yes')).toBeUndefined()
    expect(parseSetting('fileGuard', ' ')).toBeUndefined()
  })

  it('keeps the existing fields strict', () => {
    expect(parseSetting('nestedRepositories', 'all')).toBe('all')
    expect(parseSetting('nestedRepositories', 'everything')).toBeUndefined()
    expect(parseSetting('defaultPath', 'home')).toBe('home')
    expect(parseSetting('nestedScanDepth', '2')).toBe(2)
    expect(parseSetting('nestedScanDepth', '')).toBeUndefined()
    expect(parseSetting('nestedScanDepth', '0')).toBeUndefined()
  })
})
