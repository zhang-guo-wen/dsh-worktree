/**
 * Self-contained spec runner: the specs that need nothing from the checkout
 * beyond its `vitest` binary.
 *
 *   node_modules/.bin/vitest run --root dsh-worktree     # from the Harness checkout
 *
 * The service specs drive real `git` processes against scratch repositories,
 * and the route and plugin specs mount real modules; all of them resolve their
 * own imports. The browser-half specs that mount the plugin are excluded
 * because they load modules whose runtime imports resolve only through the
 * checkout's pnpm store — see `vitest.harness.config.ts`, which owns them.
 */
export default {
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: [
      'node_modules/**',
      'tests/seat.spec.ts',
      'tests/registration.spec.ts',
      'tests/navigation.spec.ts',
      'tests/settings.spec.ts',
    ],
    environment: 'node',
    pool: 'forks',
    // Real git over scratch repositories: the default bound measures the host's
    // load as much as the behavior under test.
    testTimeout: 30_000,
  },
}
