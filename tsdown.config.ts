import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  platform: 'node',
  dts: false,
  // Harness packages resolve from the host at runtime, so they stay external
  // rather than being bundled into this artifact. `diff` is an ordinary
  // installed dependency of this package; keeping it out of the artifact is
  // what lets the Host use it without this bundle carrying a second copy.
  deps: { neverBundle: [/^@deepseek-ai\//, 'diff'] },
  clean: true,
})
