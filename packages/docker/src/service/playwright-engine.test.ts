import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock playwright-core ---
// vi.hoisted runs before vi.mock hoisting, so these refs are available
// inside the factory.

const {
  mockPage, mockRequestGet, mockContext, mockBrowser, connectOverCDPMock,
} = vi.hoisted(() => {
  const _mockPage = {
    goto: vi.fn(),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    content: vi.fn(),
    url: vi.fn(),
  };
  const _mockRequestGet = vi.fn();
  const _mockContext = {
    newPage: vi.fn().mockResolvedValue(_mockPage),
    request: { get: _mockRequestGet },
    close: vi.fn().mockResolvedValue(undefined),
  };
  const _mockBrowser = {
    isConnected: vi.fn().mockReturnValue(true),
    newContext: vi.fn().mockResolvedValue(_mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const _connectOverCDPMock = vi.fn().mockResolvedValue(_mockBrowser);
  return {
    mockPage: _mockPage,
    mockRequestGet: _mockRequestGet,
    mockContext: _mockContext,
    mockBrowser: _mockBrowser,
    connectOverCDPMock: _connectOverCDPMock,
  };
});

vi.mock('playwright-core', () => ({
  chromium: { connectOverCDP: connectOverCDPMock },
}));

import { CdpEngine } from './playwright-engine.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults after each test.
  mockBrowser.isConnected.mockReturnValue(true);
  connectOverCDPMock.mockResolvedValue(mockBrowser);
  mockContext.close.mockResolvedValue(undefined);
  mockContext.newPage.mockResolvedValue(mockPage);
  mockPage.waitForLoadState.mockResolvedValue(undefined);
});

describe('CdpEngine connection management', () => {
  it('connects lazily on first isReady call', async () => {
    const engine = new CdpEngine('http://127.0.0.1:9222');
    expect(connectOverCDPMock).not.toHaveBeenCalled();
    const ready = await engine.isReady();
    expect(ready).toBe(true);
    expect(connectOverCDPMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9222',
    );
  });

  it('reuses the browser on subsequent calls', async () => {
    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.isReady();
    await engine.isReady();
    expect(connectOverCDPMock).toHaveBeenCalledTimes(1);
  });

  it('reconnects when the cached browser is disconnected', async () => {
    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.isReady();
    expect(connectOverCDPMock).toHaveBeenCalledTimes(1);

    // Simulate disconnect.
    mockBrowser.isConnected.mockReturnValue(false);
    const freshBrowser = {
      ...mockBrowser,
      isConnected: vi.fn().mockReturnValue(true),
    };
    connectOverCDPMock.mockResolvedValue(freshBrowser);

    const ready = await engine.isReady();
    expect(ready).toBe(true);
    expect(connectOverCDPMock).toHaveBeenCalledTimes(2);
  });

  it('returns false when connection fails', async () => {
    connectOverCDPMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const engine = new CdpEngine('http://127.0.0.1:9222');
    const ready = await engine.isReady();
    expect(ready).toBe(false);
  });
});

describe('CdpEngine.request', () => {
  it('makes a GET request and returns status, headers, and body', async () => {
    const bodyBuf = Buffer.from('response body', 'utf8');
    mockRequestGet.mockResolvedValue({
      status: () => 200,
      headers: () => ({ 'content-type': 'text/html' }),
      body: () => Promise.resolve(bodyBuf),
    });

    const engine = new CdpEngine('http://127.0.0.1:9222');
    const result = await engine.request(
      'https://example.com', { accept: 'text/html' }, 5000,
    );

    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('text/html');
    const body = await result.body();
    expect(body.toString('utf8')).toBe('response body');

    // Verify the request was made with correct params.
    expect(mockRequestGet).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: { accept: 'text/html' },
        maxRedirects: 0,
        timeout: 5000,
        failOnStatusCode: false,
      }),
    );
  });

  it('closes the context after the request completes', async () => {
    mockRequestGet.mockResolvedValue({
      status: () => 200,
      headers: () => ({}),
      body: () => Promise.resolve(Buffer.alloc(0)),
    });

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.request('https://example.com', {}, 5000);
    expect(mockContext.close).toHaveBeenCalled();
  });

  it('closes the context even when the request throws', async () => {
    mockRequestGet.mockRejectedValue(new Error('timeout'));

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await expect(
      engine.request('https://example.com', {}, 5000),
    ).rejects.toThrow('timeout');
    expect(mockContext.close).toHaveBeenCalled();
  });
});

describe('CdpEngine.render', () => {
  it('navigates, waits for network idle, and returns HTML', async () => {
    const resp = {
      status: () => 200,
      headers: () => ({ 'content-type': 'text/html; charset=utf-8' }),
    };
    mockPage.goto.mockResolvedValue(resp);
    mockPage.content.mockResolvedValue('<html><body>rendered</body></html>');
    mockPage.url.mockReturnValue('https://example.com/final');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    const result = await engine.render(
      'https://example.com', { 'accept-language': 'en' }, 10000,
    );

    expect(result.finalUrl).toBe('https://example.com/final');
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/html; charset=utf-8');
    expect(result.html).toContain('rendered');
  });

  it('passes extra HTTP headers via context options', async () => {
    mockPage.goto.mockResolvedValue({
      status: () => 200, headers: () => ({}),
    });
    mockPage.content.mockResolvedValue('<html></html>');
    mockPage.url.mockReturnValue('https://x.com');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.render(
      'https://x.com', { 'x-custom': 'val' }, 5000,
    );

    expect(mockBrowser.newContext).toHaveBeenCalledWith({
      extraHTTPHeaders: { 'x-custom': 'val' },
    });
  });

  it('uses domcontentloaded wait strategy with the caller timeout', async () => {
    mockPage.goto.mockResolvedValue({
      status: () => 200, headers: () => ({}),
    });
    mockPage.content.mockResolvedValue('<html></html>');
    mockPage.url.mockReturnValue('https://x.com');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.render('https://x.com', {}, 8000);

    expect(mockPage.goto).toHaveBeenCalledWith('https://x.com', {
      waitUntil: 'domcontentloaded',
      timeout: 8000,
    });
  });

  it('caps network idle wait at 3000ms', async () => {
    mockPage.goto.mockResolvedValue({
      status: () => 200, headers: () => ({}),
    });
    mockPage.content.mockResolvedValue('<html></html>');
    mockPage.url.mockReturnValue('https://x.com');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.render('https://x.com', {}, 10000);

    expect(mockPage.waitForLoadState).toHaveBeenCalledWith(
      'networkidle', { timeout: 3000 },
    );
  });

  it('uses callerTimeout when it is less than 3000ms', async () => {
    mockPage.goto.mockResolvedValue({
      status: () => 200, headers: () => ({}),
    });
    mockPage.content.mockResolvedValue('<html></html>');
    mockPage.url.mockReturnValue('https://x.com');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.render('https://x.com', {}, 1500);

    expect(mockPage.waitForLoadState).toHaveBeenCalledWith(
      'networkidle', { timeout: 1500 },
    );
  });

  it('tolerates network idle timeout failure', async () => {
    mockPage.goto.mockResolvedValue({
      status: () => 200, headers: () => ({}),
    });
    mockPage.waitForLoadState.mockRejectedValue(
      new Error('Timeout 3000ms exceeded'),
    );
    mockPage.content.mockResolvedValue('<html><body>ok</body></html>');
    mockPage.url.mockReturnValue('https://x.com');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    const result = await engine.render('https://x.com', {}, 5000);

    // Should still succeed: networkidle is best-effort.
    expect(result.html).toContain('ok');
  });

  it('defaults to status 200 when goto returns null', async () => {
    mockPage.goto.mockResolvedValue(null);
    mockPage.content.mockResolvedValue('<html></html>');
    mockPage.url.mockReturnValue('https://x.com');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    const result = await engine.render('https://x.com', {}, 5000);

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/html');
    expect(result.headers).toEqual({});
  });

  it('closes the context after render completes', async () => {
    mockPage.goto.mockResolvedValue({
      status: () => 200, headers: () => ({}),
    });
    mockPage.content.mockResolvedValue('<html></html>');
    mockPage.url.mockReturnValue('https://x.com');

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.render('https://x.com', {}, 5000);
    expect(mockContext.close).toHaveBeenCalled();
  });

  it('closes the context even when goto throws', async () => {
    mockPage.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

    const engine = new CdpEngine('http://127.0.0.1:9222');
    await expect(
      engine.render('https://x.com', {}, 5000),
    ).rejects.toThrow('net::ERR_CONNECTION_REFUSED');
    expect(mockContext.close).toHaveBeenCalled();
  });
});

describe('CdpEngine.close', () => {
  it('closes the browser when connected', async () => {
    const engine = new CdpEngine('http://127.0.0.1:9222');
    await engine.isReady(); // trigger connect
    await engine.close();
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('is a no-op when no browser is connected', async () => {
    const engine = new CdpEngine('http://127.0.0.1:9222');
    // Do not connect. close should not throw.
    await engine.close();
    expect(mockBrowser.close).not.toHaveBeenCalled();
  });
});
