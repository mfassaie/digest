import { describe, it, expect } from 'vitest';
import type { FetchRequest, ContentCategory } from './types.js';

describe('types', () => {
  it('FetchRequest accepts valid input', () => {
    const req: FetchRequest = {
      url: 'https://example.com',
      timeoutSeconds: 30,
    };
    expect(req.url).toBe('https://example.com');
    expect(req.timeoutSeconds).toBe(30);
    expect(req.prompt).toBeUndefined();
  });

  it('ContentCategory covers expected types', () => {
    const categories: ContentCategory[] = [
      'html', 'text', 'json', 'binary',
    ];
    expect(categories).toHaveLength(4);
  });
});
