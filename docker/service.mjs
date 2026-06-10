// src/service.ts
import { createServer } from "node:http";

// src/playwright-engine.ts
import { chromium } from "playwright-core";
var CdpEngine = class {
  constructor(cdpUrl) {
    this.cdpUrl = cdpUrl;
  }
  cdpUrl;
  browser;
  async getBrowser() {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.connectOverCDP(this.cdpUrl);
    return this.browser;
  }
  async isReady() {
    try {
      const b = await this.getBrowser();
      return b.isConnected();
    } catch {
      return false;
    }
  }
  async request(url, headers, timeoutMs) {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    try {
      const res = await context.request.get(url, {
        headers,
        maxRedirects: 0,
        timeout: timeoutMs,
        failOnStatusCode: false
      });
      const body = await res.body();
      const h = res.headers();
      const status = res.status();
      return {
        status,
        headers: h,
        body: async () => body
      };
    } finally {
      await context.close();
    }
  }
  async render(url, headers, timeoutMs) {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: headers["User-Agent"],
      extraHTTPHeaders: headers
    });
    const page = await context.newPage();
    try {
      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
      await page.waitForLoadState("networkidle", {
        timeout: Math.min(3e3, timeoutMs)
      }).catch(() => {
      });
      const html = await page.content();
      const respHeaders = resp?.headers() ?? {};
      return {
        finalUrl: page.url(),
        status: resp?.status() ?? 200,
        contentType: respHeaders["content-type"] ?? "text/html",
        html
      };
    } finally {
      await context.close();
    }
  }
  async close() {
    if (this.browser?.isConnected()) await this.browser.close();
  }
};

// src/fetch-orchestrator.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// src/engine.ts
var USER_AGENT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)";

// src/converter.ts
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
function classifyContentType(contentType) {
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if (ct === "text/html" || ct === "application/xhtml+xml") return "html";
  if (ct === "text/plain" || ct === "text/markdown" || ct === "text/xml" || ct === "application/xml") return "text";
  if (ct === "application/json") return "json";
  return "binary";
}
var EXT_MAP = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/xml": "xml",
  "application/xml": "xml",
  "application/json": "json",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "application/zip": "zip"
};
function getFileExtension(contentType) {
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return EXT_MAP[ct] ?? "bin";
}
async function convertHtml(html, url) {
  const { document } = parseHTML(html);
  const r = await Defuddle(document, url, {
    markdown: true,
    // Deterministic, no third-party network calls during conversion.
    useAsync: false
  });
  return {
    markdown: r.content,
    meta: {
      title: r.title || void 0,
      description: r.description || void 0,
      author: r.author || void 0,
      published: r.published || void 0,
      site: r.site || void 0,
      language: r.language || void 0,
      wordCount: typeof r.wordCount === "number" ? r.wordCount : void 0,
      image: r.image || void 0
    }
  };
}

// src/structure.ts
function slugify(text, used) {
  const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "section";
  let slug = base;
  let n = 1;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}
function parseHeadings(markdown) {
  const lines = markdown.split("\n");
  const heads = [];
  let inFence = false;
  let marker = "";
  lines.forEach((line, idx) => {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        marker = fence[1][0];
      } else if (fence[1][0] === marker) {
        inFence = false;
      }
      return;
    }
    if (inFence) return;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: idx + 1 });
  });
  return heads;
}
function buildStructure(markdown) {
  const totalLines = markdown.split("\n").length;
  const heads = parseHeadings(markdown);
  const used = /* @__PURE__ */ new Set();
  return heads.map((h, i) => {
    let end = totalLines;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].line - 1;
        break;
      }
    }
    return {
      level: h.level,
      title: h.title,
      slug: slugify(h.title, used),
      startLine: h.line,
      endLine: end
    };
  });
}

// src/fetch-orchestrator.ts
var MAX_REDIRECTS = 5;
function baseHeaders(v) {
  const h = { "User-Agent": USER_AGENT };
  if (v?.etag) h["If-None-Match"] = v.etag;
  if (v?.lastModified) h["If-Modified-Since"] = v.lastModified;
  return h;
}
async function preflight(engine2, input, timeoutMs) {
  let currentUrl = input.url;
  const headers = baseHeaders(input.validators);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await engine2.request(currentUrl, headers, timeoutMs);
    if (res.status === 304) return { kind: "not-modified" };
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers["location"];
      if (!location) break;
      const target = new URL(location, currentUrl).href;
      if (new URL(currentUrl).host !== new URL(target).host) {
        return { kind: "cross-host", fromUrl: currentUrl, toUrl: target };
      }
      currentUrl = target;
      continue;
    }
    if (res.status >= 400) return { kind: "http-error", status: res.status };
    return {
      kind: "content",
      status: res.status,
      finalUrl: currentUrl,
      contentType: res.headers["content-type"] ?? "",
      body: await res.body()
    };
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS}) following ${input.url}`);
}
async function orchestrateFetch(engine2, dataRoot, input) {
  const timeoutMs = input.timeoutSeconds * 1e3;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  let pre;
  try {
    pre = await preflight(engine2, input, timeoutMs);
  } catch (err) {
    return {
      outcome: "fetch-failed",
      reason: err instanceof Error ? err.message : String(err)
    };
  }
  if (pre.kind === "not-modified") return { outcome: "not-modified" };
  if (pre.kind === "http-error") {
    return { outcome: "http-error", status: pre.status ?? 0 };
  }
  if (pre.kind === "cross-host") {
    return {
      outcome: "cross-host-redirect",
      fromUrl: pre.fromUrl,
      toUrl: pre.toUrl
    };
  }
  const finalUrl = pre.finalUrl;
  const contentType = pre.contentType ?? "";
  const category = classifyContentType(contentType);
  const dir = join(dataRoot, input.cachePath);
  await mkdir(dir, { recursive: true });
  if (category !== "html" || input.rawOnly) {
    const ext = getFileExtension(contentType);
    const rawName2 = `raw.${ext}`;
    const body = pre.body ?? Buffer.alloc(0);
    await writeFile(join(dir, rawName2), body);
    return {
      outcome: "fetched",
      status: pre.status ?? 200,
      finalUrl,
      contentType,
      category,
      meta: {},
      sections: [],
      files: { raw: rawName2 },
      bytes: { raw: body.length }
    };
  }
  let html;
  let status = pre.status ?? 200;
  try {
    if (remaining() < 500) throw new Error("no time budget to render");
    const rendered = await engine2.render(finalUrl, baseHeaders(), remaining());
    html = rendered.html;
    status = rendered.status || status;
  } catch {
    html = pre.body ? pre.body.toString("utf8") : "";
  }
  const { markdown, meta } = await convertHtml(html, finalUrl);
  const sections = buildStructure(markdown);
  const rawName = "raw.html";
  const mdName = "content.md";
  const structName = "structure.json";
  await writeFile(join(dir, rawName), html, "utf8");
  await writeFile(join(dir, mdName), markdown, "utf8");
  await writeFile(
    join(dir, structName),
    JSON.stringify(sections, null, 2),
    "utf8"
  );
  return {
    outcome: "fetched",
    status,
    finalUrl,
    contentType,
    category,
    meta,
    sections,
    files: { raw: rawName, markdown: mdName, structure: structName },
    bytes: {
      raw: Buffer.byteLength(html, "utf8"),
      markdown: Buffer.byteLength(markdown, "utf8")
    }
  };
}

// src/service.ts
var SERVICE_PORT = Number(process.env.SERVICE_PORT ?? 8932);
var CDP_URL = process.env.CDP_URL ?? "http://127.0.0.1:9222";
var DATA_ROOT = process.env.DATA_ROOT ?? "/data";
var VERSION = process.env.FALK_VERSION ?? "0.2.0";
var engine = new CdpEngine(CDP_URL);
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
function validateInput(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  if (typeof r.url !== "string" || typeof r.cachePath !== "string") {
    return null;
  }
  return {
    url: r.url,
    cachePath: r.cachePath,
    timeoutSeconds: typeof r.timeoutSeconds === "number" ? r.timeoutSeconds : 30,
    rawOnly: r.rawOnly === true,
    validators: typeof r.validators === "object" && r.validators !== null ? r.validators : void 0
  };
}
async function handle(req, res) {
  if (req.method === "GET" && req.url === "/healthz") {
    const cdpConnected = await engine.isReady();
    sendJson(res, cdpConnected ? 200 : 503, {
      status: cdpConnected ? "ok" : "cdp-unavailable",
      cdpConnected,
      version: VERSION
    });
    return;
  }
  if (req.method === "POST" && req.url === "/fetch") {
    let input;
    try {
      input = validateInput(JSON.parse(await readBody(req)));
    } catch {
      sendJson(res, 400, { outcome: "fetch-failed", reason: "invalid JSON" });
      return;
    }
    if (!input) {
      sendJson(res, 400, {
        outcome: "fetch-failed",
        reason: "url and cachePath required"
      });
      return;
    }
    try {
      const result = await orchestrateFetch(engine, DATA_ROOT, input);
      const code = result.outcome === "timeout" ? 504 : result.outcome === "fetch-failed" ? 502 : 200;
      sendJson(res, code, result);
    } catch (err) {
      sendJson(res, 502, {
        outcome: "fetch-failed",
        reason: err instanceof Error ? err.message : String(err)
      });
    }
    return;
  }
  sendJson(res, 404, { error: "not found" });
}
var server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err)
    });
  });
});
server.listen(SERVICE_PORT, () => {
  process.stderr.write(
    `falk-document service on :${SERVICE_PORT}, CDP ${CDP_URL}
`
  );
});
