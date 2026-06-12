import { SettingsError } from './loader.js';
import { normaliseMime, provisionalMime } from './mime.js';
import type { Settings, TypeRule } from './schema.js';

// Rule resolution (design §4.1/§4.3): exact MIME > type wildcard
// (type/*) > */*. Effective settings always carry */*.

// Most specific entry of a per-MIME-pattern map for a content type.
// Generic so the chunking strategy map resolves the same way (M8).
export function matchMimePattern<T>(
  map: Record<string, T>, contentType: string,
): T | undefined {
  const mime = normaliseMime(contentType);
  const exact = map[mime];
  if (exact !== undefined) return exact;
  const wildcard = map[`${mime.split('/')[0]}/*`];
  if (wildcard !== undefined) return wildcard;
  return map['*/*'];
}

// Authoritative resolution from a response Content-Type.
export function resolveRule(
  settings: Settings, contentType: string,
): TypeRule {
  const rule = matchMimePattern(settings.types, contentType);
  if (rule === undefined) {
    throw new SettingsError(
      "settings carry no '*/*' rule — effective settings must always " +
      'include one',
    );
  }
  return rule;
}

// Provisional (pre-network) resolution from a URI: path extension → MIME
// via the inverse EXT_MAP; unknown or no extension resolves to the
// text/html rule (design §4.3).
export function resolveRuleForUri(settings: Settings, uri: string): TypeRule {
  return resolveRule(settings, provisionalMime(uri));
}
