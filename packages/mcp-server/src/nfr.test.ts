import { describe, it, expect } from 'vitest';
import { createArtefactStore } from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';

describe('NFR-003: Startup time', () => {
  it('server module imports in under 2 seconds', async () => {
    const start = Date.now();
    const { createServer } = await import('./server.js');
    const server = createServer({
      store: createArtefactStore('.'),
      settings: DEFAULT_SETTINGS,
    });
    const elapsed = Date.now() - start;

    expect(server).toBeDefined();
    expect(elapsed).toBeLessThan(2000);
  });
});
