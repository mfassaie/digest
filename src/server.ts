import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from
  '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { normaliseUrl, fetchWithRedirects } from './fetcher.js';
import { processContent } from './converter.js';
import {
  getCacheDir,
  writeCacheEntry,
  readCacheMeta,
} from './cache.js';
import {
  formatSuccess,
  formatError,
  formatRedirect,
} from './response.js';
import type { CacheMeta } from './types.js';
import { stat } from 'node:fs/promises';

export function createServer() {
  const server = new McpServer({
    name: 'webfetch-plus',
    version: '0.1.0',
  });

  server.tool(
    'webfetch_plus',
    'Fetch a URL with timeout protection. Returns file ' +
    'paths to cached content on disk.',
    {
      url: z.string().describe(
        'URL to fetch. HTTP auto-upgraded to HTTPS.'
      ),
      prompt: z.string().optional().describe(
        'Context for the fetch (accepted for ' +
        'compatibility, currently unused).'
      ),
      timeout_seconds: z.number().optional().default(30)
        .describe('Hard timeout in seconds. Default 30.'),
    },
    (args) => handleWebfetchPlus(args),
  );

  return server;
}

export async function handleWebfetchPlus(
  { url, timeout_seconds = 30 }: {
    url: string;
    prompt?: string;
    timeout_seconds?: number;
  },
) {
  try {
    const normUrl = normaliseUrl(url);
    const cacheDir = getCacheDir(normUrl);
    const cachedMeta = await readCacheMeta(cacheDir);

    if (cachedMeta) {
      const validated = await tryConditionalFetch(
        normUrl, timeout_seconds, cachedMeta, cacheDir
      );
      if (validated) return validated;
    }

    return await freshFetch(
      normUrl, timeout_seconds, cacheDir
    );
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message : String(err);
    const reason = message.includes('aborted')
      || message.includes('Timeout')
      ? `Timeout after ${timeout_seconds} seconds`
      : message;
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: formatError(url, reason),
      }],
    };
  }
}

async function tryConditionalFetch(
  url: string,
  timeoutSeconds: number,
  meta: CacheMeta,
  cacheDir: string,
) {
  const headers: Record<string, string> = {};
  if (meta.etag) headers['If-None-Match'] = meta.etag;
  if (meta.lastModified) {
    headers['If-Modified-Since'] = meta.lastModified;
  }

  if (!meta.etag && !meta.lastModified) return null;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like ' +
          'Gecko; compatible; Claude-User/1.0; ' +
          '+Claude-User@anthropic.com)',
        ...headers,
      },
    });

    if (res.status === 304) {
      return await buildCachedResponse(url, meta, cacheDir);
    }
  } catch {
    // conditional fetch failed, fall through to fresh fetch
  }

  return null;
}

async function buildCachedResponse(
  url: string,
  meta: CacheMeta,
  cacheDir: string,
) {
  const { join } = await import('node:path');
  const { readdir } = await import('node:fs/promises');

  const files = await readdir(cacheDir);
  const rawFileName = files.find(f => f.startsWith('raw.'));
  const hasMarkdown = files.includes('content.md');

  const rawFile = join(cacheDir, rawFileName ?? 'raw.bin');
  const markdownFile = hasMarkdown
    ? join(cacheDir, 'content.md') : undefined;

  const rawStat = await stat(rawFile);
  const mdStat = markdownFile
    ? await stat(markdownFile) : undefined;

  return {
    content: [{
      type: 'text' as const,
      text: formatSuccess({
        url,
        status: 200,
        contentType: meta.contentType,
        rawFile,
        rawSize: rawStat.size,
        markdownFile,
        markdownSize: mdStat?.size,
        fetchedAt: meta.fetchedAt,
        source: 'cache (validated)',
      }),
    }],
  };
}

async function freshFetch(
  url: string,
  timeoutSeconds: number,
  cacheDir: string,
) {
  const redirectResult = await fetchWithRedirects(
    url, timeoutSeconds
  );

  if (redirectResult.type === 'cross-host') {
    return {
      content: [{
        type: 'text' as const,
        text: formatRedirect(
          redirectResult.fromUrl, redirectResult.toUrl
        ),
      }],
    };
  }

  const { result } = redirectResult;

  if (result.status >= 400) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: formatError(
          url, `HTTP ${result.status}`
        ),
      }],
    };
  }

  const processed = await processContent(
    result.body, result.contentType, url
  );

  const fetchedAt = new Date().toISOString();
  const meta: CacheMeta = {
    url,
    etag: result.headers['etag'],
    lastModified: result.headers['last-modified'],
    contentType: result.contentType,
    fetchedAt,
  };

  const { rawFile, markdownFile } = await writeCacheEntry(
    cacheDir, meta, processed.raw, processed.ext,
    processed.markdown,
  );

  const rawSize = processed.raw.length;
  const markdownSize = processed.markdown
    ? Buffer.byteLength(processed.markdown, 'utf8')
    : undefined;

  let title: string | undefined;
  if (processed.markdown) {
    const match = processed.markdown.match(/^#\s+(.+)/m);
    if (match) title = match[1];
  }

  return {
    content: [{
      type: 'text' as const,
      text: formatSuccess({
        url,
        status: result.status,
        contentType: result.contentType,
        title,
        rawFile,
        rawSize,
        markdownFile,
        markdownSize,
        fetchedAt,
        source: 'fresh',
      }),
    }],
  };
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
