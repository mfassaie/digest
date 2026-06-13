import { describe, it, expect } from 'vitest';
import { evaluateFreshness, computeFreshUntil } from './freshness.js';
import type { ArtefactIndexEntry } from '../store/record.js';

const STAMP = '2026-06-13T10:00:00.000Z';

function entry(
  overrides: Partial<ArtefactIndexEntry> = {},
): ArtefactIndexEntry {
  return {
    artefact_id: 'AAAAAAAAAAAAAAAAAAAAAA',
    artefact_type: 'file',
    origin_uri: 'https://ex.com/guide.md',
    created_at: STAMP,
    ...overrides,
  };
}

describe('evaluateFreshness', () => {
  it('returns miss when entry is null', () => {
    const v = evaluateFreshness(null, {
      now: new Date('2026-06-13T10:00:00Z'),
    });
    expect(v).toEqual({ status: 'miss' });
  });

  it('returns stale when fresh_until is absent', () => {
    const v = evaluateFreshness(entry(), {
      now: new Date('2026-06-13T10:00:00Z'),
    });
    expect(v).toEqual({ status: 'stale' });
  });

  it('returns fresh when now is before fresh_until', () => {
    const v = evaluateFreshness(
      entry({ fresh_until: '2026-06-13T12:00:00.000Z' }),
      { now: new Date('2026-06-13T10:00:00Z') },
    );
    expect(v).toEqual({ status: 'fresh' });
  });

  it('returns stale when now equals fresh_until', () => {
    const v = evaluateFreshness(
      entry({ fresh_until: '2026-06-13T10:00:00.000Z' }),
      { now: new Date('2026-06-13T10:00:00Z') },
    );
    expect(v).toEqual({ status: 'stale' });
  });

  it('returns stale when now is past fresh_until', () => {
    const v = evaluateFreshness(
      entry({ fresh_until: '2026-06-13T09:00:00.000Z' }),
      { now: new Date('2026-06-13T10:00:00Z') },
    );
    expect(v).toEqual({ status: 'stale' });
  });
});

describe('computeFreshUntil', () => {
  it('returns a future timestamp when max-age is set', () => {
    const now = new Date('2026-06-13T10:00:00Z');
    const result = computeFreshUntil(
      { 'cache-control': 'max-age=3600' }, { now },
    );
    const expected = new Date('2026-06-13T11:00:00.000Z').getTime();
    const actual = new Date(result!).getTime();
    expect(Math.abs(actual - expected)).toBeLessThan(1000);
  });

  it('returns undefined for no-store responses', () => {
    const now = new Date('2026-06-13T10:00:00Z');
    const result = computeFreshUntil(
      { 'cache-control': 'no-store' }, { now },
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for no-cache without max-age', () => {
    const now = new Date('2026-06-13T10:00:00Z');
    const result = computeFreshUntil(
      { 'cache-control': 'no-cache' }, { now },
    );
    expect(result).toBeUndefined();
  });

  it('computes from Expires header when cache-control is absent', () => {
    const now = new Date('2026-06-13T10:00:00Z');
    const result = computeFreshUntil(
      { expires: 'Fri, 13 Jun 2026 12:00:00 GMT' }, { now },
    );
    // Should have a defined future timestamp.
    expect(result).toBeDefined();
    const freshUntil = new Date(result!).getTime();
    expect(freshUntil).toBeGreaterThan(now.getTime());
  });

  it('applies heuristic freshness when Last-Modified is set', () => {
    // 100 days old, so heuristic = 10 days (10% of age).
    const now = new Date('2026-06-13T10:00:00Z');
    const lastMod = new Date(
      now.getTime() - 100 * 24 * 3600 * 1000,
    ).toUTCString();
    const result = computeFreshUntil(
      { 'last-modified': lastMod }, { now },
    );
    expect(result).toBeDefined();
    const freshUntil = new Date(result!).getTime();
    // Should be roughly 10 days into the future.
    const tenDaysMs = 10 * 24 * 3600 * 1000;
    expect(freshUntil - now.getTime()).toBeGreaterThan(tenDaysMs * 0.8);
    expect(freshUntil - now.getTime()).toBeLessThan(tenDaysMs * 1.2);
  });
});
