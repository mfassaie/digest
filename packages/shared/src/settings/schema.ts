import { z } from 'zod';

// Settings schema (per-type pipelines design §4.1–4.2, tooling design
// §6). snake_case keys: settings files are an external surface. The same
// zod source validates files at load and generates the published
// digest-settings.schema.json, so file schema and runtime validation
// cannot drift.

// type/subtype, type/* or */*; lowercase, parameters stripped.
const MIME_PATTERN =
  /^(?:\*\/\*|[a-z0-9][a-z0-9._+-]*\/(?:\*|[a-z0-9][a-z0-9._+-]*))$/;

const mimePatternSchema = z.string().regex(
  MIME_PATTERN,
  'expected a lowercase MIME pattern: type/subtype, type/* or */*',
);

export const retrievalSchema = z.enum(['http', 'browser']);
export const runtimeSchema = z.enum(['local', 'container']);
export const escalateSchema = z.enum(['browser', 'none']);
// Parser registry ids shipped in v1 (design §4.4). Extending the registry
// regenerates the published JSON schema, so the two stay in step.
export const parserSchema = z.enum(['defuddle', 'passthrough', 'raw']);

export type RetrievalId = z.infer<typeof retrievalSchema>;
export type RuntimeId = z.infer<typeof runtimeSchema>;
export type EscalateMode = z.infer<typeof escalateSchema>;
export type ParserId = z.infer<typeof parserSchema>;

const BROWSER_NEEDS_CONTAINER =
  "retrieval 'browser' requires runtime 'container' " +
  '(the browser only exists in the container image)';

// A complete, effective per-MIME rule. browser ⇒ container is enforced
// here, at validation time, never at fetch time (design §4.1).
export const typeRuleSchema = z
  .strictObject({
    retrieval: retrievalSchema,
    parser: parserSchema,
    runtime: runtimeSchema,
    escalate: escalateSchema,
  })
  .refine((r) => r.retrieval !== 'browser' || r.runtime === 'container', {
    message: BROWSER_NEEDS_CONTAINER,
    path: ['runtime'],
  });

export type TypeRule = z.infer<typeof typeRuleSchema>;

// A rule as written in a settings file: every field optional, filled
// from the built-in rule for the same pattern, then the built-in */*
// (design §4.1). An explicit browser+local pair is rejected outright;
// pairs composed via fill-in are re-checked against typeRuleSchema by
// the loader.
export const typeRuleOverrideSchema = z
  .strictObject({
    retrieval: retrievalSchema.optional()
      .describe('how bytes are obtained: plain http or the stealth browser'),
    parser: parserSchema.optional()
      .describe('parser registry id applied to the fetched bytes'),
    runtime: runtimeSchema.optional()
      .describe('where the pipeline runs: in-process or in the container'),
    escalate: escalateSchema.optional()
      .describe("bot-block escalation: 'browser' (default) or 'none'"),
  })
  .refine((r) => !(r.retrieval === 'browser' && r.runtime === 'local'), {
    message: BROWSER_NEEDS_CONTAINER,
    path: ['runtime'],
  });

export type TypeRuleOverride = z.infer<typeof typeRuleOverrideSchema>;

// chunk_mode 'standard' strategy detail per MIME pattern. M8 wires the
// chunker; this shape is the contract. Defaults: markdown splits by
// top-level sections, everything else into byte ranges.
export const chunkStrategySchema = z.discriminatedUnion('strategy', [
  z.strictObject({
    strategy: z.literal('sections')
      .describe('split by top-level sections (markdown)'),
  }),
  z.strictObject({
    strategy: z.literal('bytes')
      .describe('split into fixed-size byte ranges'),
    chunk_bytes: z.int().min(1024).max(104_857_600).default(1_048_576)
      .describe('chunk size in bytes (default 1 MiB)'),
  }),
]);

export type ChunkStrategy = z.infer<typeof chunkStrategySchema>;

export const fetchSettingsSchema = z.strictObject({
  timeout_seconds: z.int().min(1).max(600).default(30)
    .describe('overall fetch budget per request, seconds'),
  retries: z.int().min(0).max(5).default(0)
    .describe('retries on the synchronous fetch path'),
});

export type FetchSettings = z.infer<typeof fetchSettingsSchema>;

// Shape of a settings file as written (DIGEST_CONFIG path, dev/test cwd
// digest.settings.json, or $XDG_CONFIG_HOME|~/.config/digest/
// settings.json). Every key optional; unknown keys are hard errors.
export const settingsFileSchema = z
  .strictObject({
    $schema: z.string().optional()
      .describe('editor reference to digest-settings.schema.json'),
    types: z.record(mimePatternSchema, typeRuleOverrideSchema).optional()
      .describe('per-MIME pipeline rules; exact > type/* > */*'),
    chunking: z.strictObject({
      standard: z.record(mimePatternSchema, chunkStrategySchema).optional()
        .describe("per-MIME strategy detail for chunk_mode 'standard'"),
    }).optional().describe('fetch_file chunking configuration'),
    fetch: fetchSettingsSchema.optional()
      .describe('fetch budget and retry policy'),
  })
  .meta({
    title: 'digest settings',
    description:
      'Machine-level digest configuration. Paths stay in env ' +
      '(DIGEST_* variables); behaviour lives here.',
  });

export type SettingsFile = z.infer<typeof settingsFileSchema>;

// Effective settings after merging a file (if any) over the built-in
// defaults: every rule complete, */* always present.
export interface Settings {
  types: Record<string, TypeRule>;
  chunking: { standard: Record<string, ChunkStrategy> };
  fetch: FetchSettings;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// Built-in defaults reproduce current behaviour exactly (design §4.1):
// html renders in the stealth browser, everything else is plain http
// returning raw bytes, all of it in the container.
export const DEFAULT_SETTINGS: Settings = deepFreeze({
  types: {
    'text/html': {
      retrieval: 'browser', parser: 'defuddle',
      runtime: 'container', escalate: 'browser',
    },
    'application/xhtml+xml': {
      retrieval: 'browser', parser: 'defuddle',
      runtime: 'container', escalate: 'browser',
    },
    '*/*': {
      retrieval: 'http', parser: 'raw',
      runtime: 'container', escalate: 'browser',
    },
  },
  chunking: {
    standard: {
      'text/markdown': { strategy: 'sections' },
      '*/*': { strategy: 'bytes', chunk_bytes: 1_048_576 },
    },
  },
  fetch: { timeout_seconds: 30, retries: 0 },
} satisfies Settings);

// JSON Schema for the published payload (digest-settings.schema.json,
// written by the app build step). io:'input' documents the file as
// written, with defaulted fields optional.
export function settingsJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(settingsFileSchema, {
    io: 'input',
    target: 'draft-2020-12',
  }) as Record<string, unknown>;
}
