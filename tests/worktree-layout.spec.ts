import { readFileSync } from 'node:fs'
import { transform } from 'lightningcss'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/WorktreeChip.module.css', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/client/SettingsSection.tsx', import.meta.url), 'utf8')
const settingsCss = readFileSync(new URL('../src/client/SettingsSection.module.css', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../src/client/locales.ts', import.meta.url), 'utf8')
const mobile = source.slice(source.indexOf('@media (max-width: 600px)'))
const declarations = (selector: string) => {
  const start = mobile.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  const opening = mobile.indexOf('{', start)
  return mobile.slice(opening + 1, mobile.indexOf('}', opening))
}

describe('worktree settings automatic-save surface', () => {
  it('has no manual-save/reset footer and never discards edits on page exit', () => {
    // The trailing boundary keeps the guard on save affordances: the page's own
    // `css.saveFailed` is a status line for a write the Host refused, not a
    // control that submits or discards anything.
    expect(settings).not.toMatch(/props\.(save|resetField|discard)|css\.(footer|save|resetAll)\b/)
    expect(settings).toContain("props.edit('nestedRepositories'")
    expect(settings).toContain("props.edit('nestedScanDepth'")
    expect(settings).toContain("props.edit('defaultPath'")
    expect(settings).toContain("t('settings.invalidNumber')")
  })
})

describe('file backup settings page', () => {
  it('groups the rows into a worktree card above a backup card', () => {
    const worktree = settings.indexOf("title={t('settings.worktree.cardTitle')}")
    const backup = settings.indexOf("title={t('settings.backup.cardTitle')}")
    expect(worktree).toBeGreaterThanOrEqual(0)
    expect(backup).toBeGreaterThan(worktree)
    // Every row sits inside one of the two cards, and the rows of each card are
    // exactly the ones the split names.
    expect(settings.slice(worktree, backup)).toContain("props.edit('nestedRepositories'")
    expect(settings.slice(worktree, backup)).toContain("props.edit('nestedScanDepth'")
    expect(settings.slice(worktree, backup)).toContain("props.edit('defaultPath'")
    expect(settings.slice(backup)).toContain("props.edit('fileGuard'")
    expect(settings.slice(backup)).toContain("props.edit('denyDestructiveCommands'")
  })

  it('names the navigation entry and the page after the file backup it owns', () => {
    expect(locales).toContain("'settings.nav': '文件备份'")
    expect(locales).toContain("'settings.title': '文件备份'")
    expect(settings).toContain("t('settings.title')")
  })

  it('draws the cards on the settings card material, not an elevation shadow', () => {
    const card = settingsCss.slice(settingsCss.indexOf('.card {'), settingsCss.indexOf('.cardTitle'))
    expect(card).toMatch(/border-radius:\s*var\(--dsw-radius-xl\)/)
    expect(card).toMatch(/border:\s*0\.5px solid var\(--dsw-alias-settings-card-stroke\)/)
    expect(card).toMatch(/background:\s*var\(--dsw-alias-settings-card-fill\)/)
    expect(card).not.toMatch(/box-shadow/)
    // The closing stroke is the card's, so the last row does not draw a second.
    expect(settingsCss).toMatch(/\.card > \.row:last-child\s*\{[^}]*border-bottom:\s*0/)
  })

  it('ships the page the browser loads, not the previous one', () => {
    // The shipped bundle is what a git install runs, so the new names must
    // reach it: a forgotten rebuild keeps serving the previous page. The pairs
    // are asserted whole, because the words alone also appear in other copy.
    const built = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    for (const pair of ['"settings.nav": "文件备份"', '"settings.title": "文件备份"',
      '"settings.worktree.cardTitle": "Worktree 设置"', '"settings.backup.cardTitle": "自动备份"',
      '--dsw-alias-settings-card-fill']) {
      expect(built).toContain(pair)
    }
  })
})

describe('worktree mobile layout', () => {
  it('keeps the dock below the workspace/Agent row in both hero surfaces', () => {
    for (const phase of ["[data-phase='hero']", "[data-content-phase='hero']"]) {
      const row = declarations(`:global(${phase}) .row`)
      expect(row).toMatch(/height:\s*auto/)
      expect(row).toMatch(/margin:\s*0;/)
      expect(row).toMatch(/justify-content:\s*flex-start/)
      expect(row).toMatch(/padding:\s*0 20px/)
      const pill = declarations(`:global(${phase}) .pill`)
      expect(pill).toMatch(/position:\s*static/)
      expect(pill).toMatch(/right:\s*auto/)
      expect(pill).toMatch(/bottom:\s*auto/)
      expect(pill).toMatch(/max-width:\s*100%/)
    }
  })

  it('shrinks long branches without clipping the worktree action', () => {
    expect(declarations('.branchMenu')).toMatch(/min-width:\s*0/)
    expect(declarations('.branchMenu')).toMatch(/flex:\s*0 1 auto/)
    expect(declarations('.branch {')).toMatch(/width:\s*100%/)
    expect(declarations('.seat {')).toMatch(/flex:\s*none/)
    expect(source).toMatch(/text-overflow:\s*ellipsis/)
    const component = readFileSync(new URL('../src/client/WorktreeChip.tsx', import.meta.url), 'utf8')
    expect(component).toContain('className={css.branchMenu}')
  })

  it('compiles the mobile override after the existing desktop positioning', () => {
    const compiled = transform({
      filename: 'WorktreeChip.module.css',
      code: Buffer.from(source),
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const css = compiled.code.toString()
    expect(compiled.exports?.branchMenu).toBeDefined()
    expect(css).toContain('@media')
    expect(css.indexOf('@media')).toBeGreaterThan(css.indexOf('position:absolute'))
    expect(css).toContain('position:static')
  })
})
