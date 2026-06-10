import { chromium, type Browser } from 'playwright-core';
import type {
  BrowserEngine, PreflightResponse, RenderResult,
} from './engine.js';

// BrowserEngine backed by cloakserve's CDP multiplexer. Lazily connects and
// reconnects if the connection drops, so cloakserve idle behaviour cannot
// wedge the service.
export class CdpEngine implements BrowserEngine {
  private browser?: Browser;

  constructor(private readonly cdpUrl: string) {}

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.connectOverCDP(this.cdpUrl);
    return this.browser;
  }

  async isReady(): Promise<boolean> {
    try {
      const b = await this.getBrowser();
      return b.isConnected();
    } catch {
      return false;
    }
  }

  async request(
    url: string, headers: Record<string, string>, timeoutMs: number,
  ): Promise<PreflightResponse> {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    try {
      const res = await context.request.get(url, {
        headers,
        maxRedirects: 0,
        timeout: timeoutMs,
        failOnStatusCode: false,
      });
      const body = await res.body();
      const h = res.headers();
      const status = res.status();
      return {
        status,
        headers: h,
        body: async () => body,
      };
    } finally {
      await context.close();
    }
  }

  async render(
    url: string, headers: Record<string, string>, timeoutMs: number,
  ): Promise<RenderResult> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: headers['User-Agent'],
      extraHTTPHeaders: headers,
    });
    const page = await context.newPage();
    try {
      const resp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      // Best-effort settle for late-hydrating SPAs, bounded by the budget.
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(3000, timeoutMs),
      }).catch(() => {});
      const html = await page.content();
      const respHeaders = resp?.headers() ?? {};
      return {
        finalUrl: page.url(),
        status: resp?.status() ?? 200,
        contentType: respHeaders['content-type'] ?? 'text/html',
        html,
      };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser?.isConnected()) await this.browser.close();
  }
}
