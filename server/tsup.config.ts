import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // @ea/shared is a source-only TypeScript package: bundle it instead of
  // leaving a runtime import that Node could not resolve.
  noExternal: ['@ea/shared'],
});
