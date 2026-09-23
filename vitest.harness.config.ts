/**
 * Full-suite runner: every spec in this package, resolved against the sibling
 * DeepSeek Harness checkout.
 *
 * This package does not install the Harness runtime packages its browser half
 * needs, nor the state library `dsh-client-store` imports at runtime. Running
 * from the Harness checkout makes the workspace's own resolution apply:
 *
 *   node_modules/.bin/vitest run --root dsh-worktree --config vitest.harness.config.ts
 *
 * `vitest.config.ts` is the self-contained subset that runs without the
 * checkout; it covers the Host half and the browser half's pure modules.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../vitest.shared.ts'

/**
 * Locate a package the checkout keeps only in its pnpm store, so a browser
 * spec's React face resolves without pinning a version here.
 * @param name - package name to locate.
 * @returns the absolute package directory of the newest stored copy.
 */
function pnpmPackage(name: string): string {
  const store = fileURLToPath(new URL('../node_modules/.pnpm/', import.meta.url))
  const entries = readdirSync(store).filter(entry => entry.startsWith(`${name}@`)).sort()
  const entry = entries[entries.length - 1]
  if (entry === undefined) throw new Error(`no stored ${name} in ${store}`)
  return join(store, entry, 'node_modules', name)
}

const react = pnpmPackage('react')
const zustand = pnpmPackage('zustand')

export default {
  plugins: [tsconfigPaths({ projects: ['../tsconfig.base.json'] }), standardDecoratorPlugin()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: `${react}/index.js` },
      { find: /^react\/jsx-runtime$/, replacement: `${react}/jsx-runtime.js` },
      // `dsh-client-store` re-exports from zustand, and the browser resolves
      // that through the module table; a Node spec resolves it here instead.
      { find: /^zustand$/, replacement: `${zustand}/index.js` },
    ],
  },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    environment: 'node',
    pool: 'forks',
    execArgv: vitestExecArgv,
  },
}
