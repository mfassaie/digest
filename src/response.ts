export interface SuccessParams {
  url: string;
  status: number;
  contentType: string;
  title?: string;
  rawFile: string;
  rawSize: number;
  markdownFile?: string;
  markdownSize?: number;
  fetchedAt: string;
  source: 'fresh' | 'cache (validated)';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSuccess(params: SuccessParams): string {
  const lines: string[] = [
    `URL: ${params.url}`,
    `Status: ${params.status}`,
    `Content-Type: ${params.contentType}`,
  ];

  if (params.title) {
    lines.push(`Title: ${params.title}`);
  }

  lines.push('');
  lines.push('Files:');
  if (params.markdownFile) {
    lines.push(`  markdown: ${params.markdownFile}`);
  }
  lines.push(`  raw: ${params.rawFile}`);

  lines.push('');
  const sizeParts: string[] = [];
  if (params.markdownSize !== undefined) {
    sizeParts.push(
      `${formatSize(params.markdownSize)} (markdown)`
    );
  }
  sizeParts.push(`${formatSize(params.rawSize)} (raw)`);
  lines.push(`Size: ${sizeParts.join(' | ')}`);

  lines.push(`Fetched: ${params.fetchedAt}`);
  lines.push(`Source: ${params.source}`);

  return lines.join('\n');
}

export function formatError(
  url: string, reason: string,
): string {
  return `Error fetching ${url}\nReason: ${reason}`;
}

export function formatRedirect(
  fromUrl: string, toUrl: string,
): string {
  return [
    'Redirect detected (cross-host):',
    `  From: ${fromUrl}`,
    `  To: ${toUrl}`,
    '',
    'Make a new request with the redirect URL ' +
    'to fetch the content.',
  ].join('\n');
}
