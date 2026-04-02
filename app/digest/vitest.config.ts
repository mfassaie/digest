import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts is the bin entry: it runs only as a subprocess (cli-e2e
      // drives the built bundle), so instrumentation cannot see it.
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
