export type ContentCategory = 'html' | 'text' | 'json' | 'binary';

export interface Section {
  level: number;
  title: string;
  slug: string;
  startLine: number;
  endLine: number;
}

// Persisted alongside cached content (meta.json). Written by the host after
// a successful container fetch.
export interface CacheMeta {
  cacheVersion: 2;
  url: string;
  finalUrl: string;
  contentType: string;
  category: ContentCategory | string;
  converter: string;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  // Document metadata surfaced by the converter (defuddle).
  title?: string;
  description?: string;
  author?: string;
  published?: string;
  site?: string;
  language?: string;
  wordCount?: number;
  image?: string;
  // Stored file names (relative to the cache dir).
  rawFile: string;
  markdownFile?: string;
  structureFile?: string;
}

// Request sent to the in-container service. The container is document-root-
// agnostic, so no cache path is sent — the host writes the returned content.
export interface ContainerFetchRequest {
  url: string;
  timeoutSeconds: number;
  rawOnly: boolean;
  validators?: { etag?: string; lastModified?: string };
}

// Content the container returns for the host to write.
export interface FetchContent {
  ext: string;
  raw: string; // base64-encoded raw bytes
  markdown?: string;
}

export interface DocumentMeta {
  title?: string;
  description?: string;
  author?: string;
  published?: string;
  site?: string;
  language?: string;
  wordCount?: number;
  image?: string;
}

// Response shape mirrored from the container's FetchOutcome.
export type ContainerFetchResponse =
  | {
      outcome: 'fetched';
      status: number;
      finalUrl: string;
      contentType: string;
      category: string;
      etag?: string;
      lastModified?: string;
      meta: DocumentMeta;
      sections: Section[];
      content: FetchContent;
    }
  | { outcome: 'not-modified' }
  | { outcome: 'cross-host-redirect'; fromUrl: string; toUrl: string }
  | { outcome: 'http-error'; status: number }
  | { outcome: 'timeout' }
  | { outcome: 'fetch-failed'; reason: string };

export interface CliArgs {
  subcommand: 'install' | 'uninstall' | 'setup' | 'doctor';
  scope: 'project' | 'global';
  documentRoot?: string;
  repoRoot?: string;
}

export interface ConfigTarget {
  mcpConfig: string;
  settings: string;
  localSettings: string;
  settingsDir: string;
}
