import { readFileSync } from 'node:fs'
import { transform } from 'lightningcss'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/WorktreeChip.module.css', import.meta.url), 'utf8')
const mobile = source.slice(source.indexOf('@media (max-width: 600px)'))
const declarations = (selector: string) => {
  const start = mobile.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  const opening = mobile.indexOf('{', start)
  return mobile.slice(opening + 1, mobile.indexOf('}', opening))
}

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
