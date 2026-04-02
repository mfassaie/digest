export interface FetchRequest {
  url: string;
  prompt?: string;
  timeoutSeconds: number;
}

export interface FetchResult {
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
}

export interface CacheMeta {
  url: string;
  etag?: string;
  lastModified?: string;
  contentType: string;
  fetchedAt: string;
}

export interface CacheEntry {
  dir: string;
  meta: CacheMeta;
  rawFile: string;
  markdownFile?: string;
}

export type ContentCategory =
  | 'html'
  | 'text'
  | 'json'
  | 'binary';
