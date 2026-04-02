import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Excluded beyond tests: thin adapters that need live processes —
      // service.ts (HTTP entry shell), playwright-engine.ts (live CDP
      // endpoint), log-follower.ts (spawns `docker logs`). All three are
      // exercised by the e2e targets in packages/e2e.
      exclude: [
        'src/**/*.test.ts',
        'src/service/service.ts',
        'src/service/playwright-engine.ts',
        'src/host/log-follower.ts',
      ],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
