// Browser abstraction so the orchestrator can be unit-tested without a
// real browser. The Playwright-backed implementation lives in
// playwright-engine.ts; tests inject a fake.

export interface PreflightResponse {
  status: number;
  headers: Record<string, string>;
  body(): Promise<Buffer>;
}

export interface RenderResult {
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
}

export interface BrowserEngine {
  // Single request with NO automatic redirect following (manual hops).
  request(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<PreflightResponse>;

  // Navigate to a URL and return the JS-rendered DOM serialisation.
  render(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<RenderResult>;
}

export const USER_AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; ' +
  'compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
