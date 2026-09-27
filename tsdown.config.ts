import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'lib',
  platform: 'node',
  dts: false,
  // Harness packages resolve from the host at runtime, so they stay external
  // rather than being bundled into this artifact.
  deps: { neverBundle: [/^@deepseek-ai\//] },
  clean: true,
})
