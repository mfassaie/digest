// HTTP is auto-upgraded to HTTPS, matching v1 behaviour.
export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';
  return parsed.href;
}
