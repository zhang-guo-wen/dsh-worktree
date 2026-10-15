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
 * The checkout is the sibling directory by default and `DSH_HARNESS_ROOT`
 * overrides it — the same variable `typecheck-harness.mjs` reads, so a run from
 * a linked worktree (where the package does not sit inside the checkout) names
 * the checkout once instead of failing on a relative path that is not there.
 *
 * `vitest.config.ts` is the self-contained subset that runs without the
 * checkout; it covers the Host half and the browser half's pure modules.
 */
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const harness = resolve(process.env.DSH_HARNESS_ROOT ?? fileURLToPath(new URL('../', import.meta.url)))
const requireHarness = createRequire(join(harness, 'package.json'))
const ts = requireHarness('typescript') as typeof import('typescript')
/**
 * The checkout's own source aliases, read from its `tsconfig.base.json`.
 *
 * A browser spec imports Harness packages by name; resolving them through the
 * alias list compiles the checkout's source, the same graph the checkout's own
 * specs run, rather than whatever a package build happens to hold.
 */
const harnessConfig = ts.readConfigFile(join(harness, 'tsconfig.base.json'), ts.sys.readFile)
const sourceAliases = Object.entries(
  harnessConfig.config.compilerOptions.paths as Record<string, string[]>,
).map(([name, paths]) => ({
  find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  replacement: resolve(harness, paths[0]!),
}))
const { standardDecoratorPlugin, vitestExecArgv } = await import(
  pathToFileURL(join(harness, 'vitest.shared.ts')).href
)

/**
 * Locate a package the checkout keeps only in its pnpm store, so a browser
 * spec's React face resolves without pinning a version here.
 * @param name - package name to locate.
 * @returns the absolute package directory of the newest stored copy.
 */
function pnpmPackage(name: string): string {
  const store = join(harness, 'node_modules/.pnpm')
  const entries = readdirSync(store).filter(entry => entry.startsWith(`${name}@`)).sort()
  const entry = entries[entries.length - 1]
  if (entry === undefined) throw new Error(`no stored ${name} in ${store}`)
  return join(store, entry, 'node_modules', name)
}

const react = pnpmPackage('react')
const zustand = pnpmPackage('zustand')

export default {
  plugins: [standardDecoratorPlugin()],
  resolve: {
    alias: [
      ...sourceAliases,
      { find: /^react$/, replacement: `${react}/index.js` },
      { find: /^react\/jsx-runtime$/, replacement: `${react}/jsx-runtime.js` },
      // A spec that mounts the browser half compiles its components, which the
      // development JSX transform imports from here.
      { find: /^react\/jsx-dev-runtime$/, replacement: `${react}/jsx-dev-runtime.js` },
      // `dsh-client-store` re-exports from zustand, and the browser resolves
      // that through the module table; a Node spec resolves it here instead.
      { find: /^zustand$/, replacement: `${zustand}/index.js` },
    ],
  },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    environment: 'node',
    pool: 'forks',
    // These specs drive real git over scratch repositories and files run in
    // parallel, so a submodule clone that takes a second on an idle host can
    // take several beside ten other forks — the default bound is not a signal.
    testTimeout: 30_000,
    execArgv: vitestExecArgv,
  },
}
