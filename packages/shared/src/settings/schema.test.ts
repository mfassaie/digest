import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, chunkStrategySchema, fetchSettingsSchema,
  settingsFileSchema, settingsJsonSchema, typeRuleSchema,
} from './schema.js';

describe('settingsFileSchema', () => {
  it('accepts the design example shape, $schema included', () => {
    const parsed = settingsFileSchema.parse({
      $schema: './digest-settings.schema.json',
      types: {
        'text/html': {
          retrieval: 'browser', parser: 'defuddle', runtime: 'container',
        },
        'application/pdf': {
          retrieval: 'http', parser: 'raw', runtime: 'local',
        },
        'image/*': { retrieval: 'http', parser: 'raw', runtime: 'local' },
        '*/*': { retrieval: 'http', parser: 'raw', runtime: 'container' },
      },
      chunking: { standard: { 'text/markdown': { strategy: 'sections' } } },
      fetch: { timeout_seconds: 30, retries: 0 },
    });
    expect(parsed.types?.['image/*']?.runtime).toBe('local');
  });

  it('accepts an empty file and partial rules', () => {
    expect(settingsFileSchema.parse({})).toEqual({});
    const parsed = settingsFileSchema.parse({
      types: { 'text/markdown': { parser: 'passthrough' } },
    });
    expect(parsed.types?.['text/markdown']).toEqual({
      parser: 'passthrough',
    });
  });

  it('rejects unknown top-level and rule-level keys', () => {
    expect(settingsFileSchema.safeParse({ fetcch: {} }).success).toBe(false);
    expect(settingsFileSchema.safeParse({
      types: { 'text/html': { converter: 'defuddle' } },
    }).success).toBe(false);
  });

  it('rejects malformed MIME pattern keys', () => {
    for (const key of ['html', 'TEXT/HTML', '*/json', 'text/*; q=1']) {
      expect(settingsFileSchema.safeParse({
        types: { [key]: { parser: 'raw' } },
      }).success).toBe(false);
    }
  });

  it('rejects an explicit browser-without-container rule', () => {
    const result = settingsFileSchema.safeParse({
      types: { 'text/html': { retrieval: 'browser', runtime: 'local' } },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues))
      .toContain("requires runtime 'container'");
  });

  it('rejects unknown enum values', () => {
    expect(settingsFileSchema.safeParse({
      types: { 'text/html': { parser: 'pandoc' } },
    }).success).toBe(false);
    expect(settingsFileSchema.safeParse({
      types: { 'text/html': { retrieval: 'ftp' } },
    }).success).toBe(false);
  });
});

describe('typeRuleSchema (effective rules)', () => {
  it('enforces browser ⇒ container', () => {
    expect(typeRuleSchema.safeParse({
      retrieval: 'browser', parser: 'defuddle',
      runtime: 'local', escalate: 'browser',
    }).success).toBe(false);
    expect(typeRuleSchema.safeParse({
      retrieval: 'browser', parser: 'defuddle',
      runtime: 'container', escalate: 'browser',
    }).success).toBe(true);
  });

  it('requires every field', () => {
    expect(typeRuleSchema.safeParse({
      retrieval: 'http', parser: 'raw', runtime: 'local',
    }).success).toBe(false);
  });
});

describe('chunkStrategySchema', () => {
  it('defaults chunk_bytes to 1 MiB and bounds it', () => {
    expect(chunkStrategySchema.parse({ strategy: 'bytes' }))
      .toEqual({ strategy: 'bytes', chunk_bytes: 1_048_576 });
    expect(chunkStrategySchema.safeParse({
      strategy: 'bytes', chunk_bytes: 512,
    }).success).toBe(false);
  });

  it('rejects strategy-foreign fields', () => {
    expect(chunkStrategySchema.safeParse({
      strategy: 'sections', chunk_bytes: 4096,
    }).success).toBe(false);
  });
});

describe('fetchSettingsSchema', () => {
  it('defaults to timeout_seconds 30 and retries 0', () => {
    expect(fetchSettingsSchema.parse({}))
      .toEqual({ timeout_seconds: 30, retries: 0 });
  });

  it('bounds both fields', () => {
    expect(fetchSettingsSchema.safeParse({ timeout_seconds: 0 }).success)
      .toBe(false);
    expect(fetchSettingsSchema.safeParse({ retries: 6 }).success).toBe(false);
    expect(fetchSettingsSchema.safeParse({ timeout_seconds: 2.5 }).success)
      .toBe(false);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('matches current behaviour exactly', () => {
    expect(DEFAULT_SETTINGS.types['text/html']).toEqual({
      retrieval: 'browser', parser: 'defuddle',
      runtime: 'container', escalate: 'browser',
    });
    expect(DEFAULT_SETTINGS.types['application/xhtml+xml']).toEqual(
      DEFAULT_SETTINGS.types['text/html'],
    );
    expect(DEFAULT_SETTINGS.types['*/*']).toEqual({
      retrieval: 'http', parser: 'raw',
      runtime: 'container', escalate: 'browser',
    });
    expect(DEFAULT_SETTINGS.fetch).toEqual({
      timeout_seconds: 30, retries: 0,
    });
  });

  it('only contains rules valid under the effective schema', () => {
    for (const rule of Object.values(DEFAULT_SETTINGS.types)) {
      expect(typeRuleSchema.safeParse(rule).success).toBe(true);
    }
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.types['*/*'])).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.chunking.standard)).toBe(true);
  });
});

describe('settingsJsonSchema', () => {
  it('emits a strict draft 2020-12 schema with defaults visible', () => {
    const schema = settingsJsonSchema() as Record<string, any>;
    expect(schema.$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.fetch.properties.timeout_seconds.default)
      .toBe(30);
    expect(schema.properties.fetch.properties.retries.default).toBe(0);
    // MIME pattern keys are constrained for editor validation.
    expect(schema.properties.types.propertyNames.pattern)
      .toContain('\\*');
    expect(schema.title).toBe('digest settings');
  });
});
