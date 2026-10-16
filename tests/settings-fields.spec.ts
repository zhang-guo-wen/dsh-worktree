/**
 * The settings page's field conversion, including the two file-protection
 * switches.
 *
 * One rule decides whether these rows tell the truth: an absent section value
 * renders as the schema default, not as `false`. A switch shown off on a
 * deployment that has it on is worse than showing nothing, because the user
 * then "fixes" a setting that was already correct.
 */

import { describe, expect, it } from 'vitest'
import {
  formatSetting, isSwitchField, parseSetting, SWITCH_DEFAULT, WORKTREE_SETTINGS_FIELDS,
} from '../src/client/settings-fields.ts'

describe('the settings page field set', () => {
  it('edits the file guard and the delete-command policy alongside the checkout policy', () => {
    expect(WORKTREE_SETTINGS_FIELDS).toEqual([
      'nestedRepositories', 'defaultPath', 'nestedScanDepth', 'fileGuard', 'denyDestructiveCommands',
    ])
    expect(isSwitchField('fileGuard')).toBe(true)
    expect(isSwitchField('denyDestructiveCommands')).toBe(true)
    expect(isSwitchField('defaultPath')).toBe(false)
  })
})

describe('rendering a stored value as draft text', () => {
  it('shows a switch as on when the section carries no value', () => {
    // Both switches default to `true`, so an absent value IS on — and the
    // absent value must also survive a round trip back to a write.
    expect(SWITCH_DEFAULT).toBe(true)
    expect(formatSetting('fileGuard', undefined)).toBe('true')
    expect(formatSetting('denyDestructiveCommands', undefined)).toBe('true')
  })

  it('shows a switch as its stored value', () => {
    expect(formatSetting('fileGuard', false)).toBe('false')
    expect(formatSetting('fileGuard', true)).toBe('true')
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
  })

  it('treats empty switch text as the schema default rather than off', () => {
    expect(parseSetting('fileGuard', '')).toBe(true)
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
