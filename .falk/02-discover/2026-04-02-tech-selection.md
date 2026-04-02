# Discovery: Technology Selection

Started: 2026-04-02
Status: complete
Activities: 5

## Problem Statement

Claude Code's built-in WebFetch has no timeout. When a subagent calls
WebFetch and the fetch never completes, the subagent hangs forever and
the parent agent has no recovery path.

**Evidence:** Analysis of 235 subagent logs showed 20 hung subagents, 15
(75%) died on a WebFetch call. 90% of hung agents had used WebFetch.

**Root cause:** The built-in tool's fetch step has no AbortController or
timeout mechanism. A request to an unresponsive server produces a promise
that never settles.

**Goal:** Replace the built-in WebFetch with an MCP server (`webfetch_plus`)
that wraps every fetch in a hard timeout. On timeout, return an error
message instead of hanging. Match the built-in's feature set where
practical (caching, summarisation, trusted domains) so the replacement is
transparent to callers.

**Anti-goals:**
- Not trying to improve on the built-in's content quality
- Not building a general-purpose web scraper
- Not handling JavaScript-rendered pages (SPA)

**Success criteria:**
- Zero hung subagents caused by web fetching
- Drop-in replacement: callers send URL + prompt, get markdown back
- Graceful degradation when Anthropic API key is missing (skip
  summarisation, return raw markdown)

**Relevant issues:**
- anthropics/claude-code#37521 (agent freezes indefinitely)
- anthropics/claude-code#11650 (WebFetch freezes, no interrupt)
- anthropics/claude-code#8980 (WebFetch hangs on inaccessible sites)

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Built-in fetch (Node.js global) for HTTP | Zero deps, AbortSignal.timeout for hard timeout, manual redirect mode, undici engine (fastest) |
| 2 | defuddle + linkedom for HTML-to-Markdown | Content extraction (removes nav, sidebars, ads) + markdown conversion in one step. Replaces node-html-markdown. Critical since we skipped Haiku: defuddle handles the content cleaning that Haiku would have done. |
| 3 | Skip Haiku summarisation | Calling agent can extract from raw markdown directly. Summarisation adds latency, API dependency, and token waste when the agent needs more detail than the summary provides. Context windows are large enough now (1M Opus, 200K Sonnet) that raw page markdown is not a problem. Revisit later if needed. |
| 4 | Match built-in User-Agent | Send `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)`. Consistent with built-in. If a site blocks this, it does not want automated access. |
| 5 | Disk-based cache at ~/.claude/webfetch-plus/ | Save both raw response and converted markdown to disk. Tool never returns content inline, only metadata + file paths. Caller uses Read to access files. No max cache size for now. |
| 6 | HTTP conditional requests for cache validation | On cache hit, send If-None-Match/If-Modified-Since. 304 = serve cached. 200 or uncertain = re-download. Replaces TTL-based lru-cache. |
| 7 | Content-type branching | HTML: defuddle extract + markdown. Text/markdown/JSON/XML: save as-is. Binary (PDF, image, etc.): save to disk, return metadata + path. All types return file paths, never inline content. |
| 8 | mcp-testing-kit for testing | In-process MCP server testing with Vitest. Mock fetch for network isolation. |

## Research Findings

### HTTP client comparison - 2026-04-02

Evaluated five options for fetching web pages in Node.js v24+ / TypeScript.

#### Built-in fetch (global, powered by undici)

| Aspect | Detail |
|--------|--------|
| Timeout | AbortSignal.timeout(ms) for hard total timeout |
| Redirect control | `redirect: 'manual'` returns actual response (not opaque), Location header accessible. Can inspect host before following |
| Dependencies | Zero. Built into Node.js since v18, stable since v21 |
| Performance | ~3x faster than axios/got (undici engine) |
| TypeScript | Types included in @types/node |
| Maintenance | Part of Node.js core, backed by undici team |
| Known issues | Historical AbortSignal.timeout bug (undici#1926), likely resolved by v24 |

**Redirect pattern for cross-host detection:**
```typescript
const res = await fetch(url, { redirect: 'manual' });
if (res.status >= 300 && res.status < 400) {
  const location = res.headers.get('location');
  const targetHost = new URL(location, url).host;
  const sourceHost = new URL(url).host;
  if (targetHost !== sourceHost) {
    // Cross-host redirect: report, don't follow
  }
}
```

#### undici (direct import)

Same engine as built-in fetch but exposes more control: interceptors,
connection pooling config, dispatcher customisation. Adds a dependency
for functionality we likely don't need beyond what global fetch provides.

#### node-libcurl

| Aspect | Detail |
|--------|--------|
| Timeout | TIMEOUT_MS, CONNECTTIMEOUT_MS (curl-native, reliable) |
| Dependencies | Native addon, requires prebuilt binaries or C++ compilation |
| Platform issues | Known Windows install failures, prebuild gaps for newer Node versions, x86 dropped |
| TypeScript | Types available |

Native bindings add build complexity. An MCP server that fails to
install because of a missing prebuild defeats the purpose. The built-in
WebFetch likely hangs at the JS level (promise never resolves), not at
the socket level, so curl's lower-level control adds no value here.

#### axios

Popular but built on the old `http` module. ~3x slower than undici.
Extra dependency. Redirect handling requires interceptors. No advantage
over built-in fetch for this use case.

#### got

Nice API with built-in retry and timeout decomposition (lookup, connect,
socket, response, etc.). ESM-only. But it is an extra dependency solving
a problem that AbortSignal.timeout already handles at zero cost.

#### Verdict: Built-in fetch. DECIDED.

### HTML-to-Markdown comparison - 2026-04-02

#### Turndown

- Most mature JS HTML-to-Markdown library
- Plugin ecosystem (tables, strikethrough, etc.)
- Used by the built-in WebFetch (per reverse engineering)
- Requires jsdom in Node.js (~20MB dependency)

#### node-html-markdown

- ~1.6x faster than Turndown
- No jsdom required (own parser)
- Less plugin flexibility
- Smaller community

#### Verdict: node-html-markdown. DECIDED.

### Feature readiness review - 2026-04-02

**Ready to implement (no discovery needed):**

| Feature | Approach |
|---------|----------|
| MCP server (stdio) | @modelcontextprotocol/sdk |
| Fetch with hard timeout | fetch + AbortSignal.timeout(ms) |
| HTML to Markdown | node-html-markdown |
| HTTP-to-HTTPS upgrade | Rewrite URL scheme before fetch |
| Content truncation | Truncate markdown at 100KB |

**Needs a decision:**

| Feature | Open question |
|---------|---------------|
| Cross-host redirect response | What format? Built-in "returns a notice, requires a new call". Match that. |
| `prompt` param without summarisation | In MVP (no Haiku), prompt is unused. Return full markdown? |

**Previously needed discovery (now researched):**

### Haiku summarisation - 2026-04-02

**Summariser prompt (reverse-engineered, 189 tokens):**

The built-in WebFetch sends page content + user prompt to a small fast
model (Haiku) with this template:

```
## ${WEB_CONTENT}

${USER_PROMPT}

${IS_TRUSTED_DOMAIN
  ? "Provide a concise response based on the content above. Include
     relevant details, code examples, and documentation excerpts as
     needed."
  : "Provide a concise response based only on the content above. In
     your response:
     - Enforce a strict 125-character maximum for quotes from any
       source document. Open Source Software is ok as long as we
       respect the license.
     - Use quotation marks for exact language from articles; any
       language outside of the quotation should never be word-for-word
       the same.
     - You are not a lawyer and never comment on the legality of your
       own prompts and responses.
     - Never produce or reproduce exact song lyrics."
}
```

**Trusted vs untrusted behaviour:**
- Trusted: generous extraction, code examples allowed, no quote limit
- Untrusted: strict 125-char quote limit, paraphrasing required
- The copyright/legal restrictions on untrusted domains are there for
  legal compliance, not technical reasons

**Fast-path (skip summarisation entirely):**
- Condition: trusted domain AND server returns Content-Type: text/markdown
  AND content < 100k chars
- In this case, raw markdown passes through directly to the caller

**Graceful degradation design:**
- If no ANTHROPIC_API_KEY: skip summarisation, return raw markdown
- This matches the fast-path behaviour for trusted domains
- Callers still get useful content, just unsummarised

**API call parameters (to determine during implementation):**
- Model: claude-haiku-4-5-20251001
- Temperature: low (0 or near-0, we want factual extraction)
- Max tokens: TBD, probably 4096 is reasonable for a summary

### LRU cache - 2026-04-02

**Library: `lru-cache` (isaacs/node-lru-cache)**
- Most popular LRU cache for Node.js
- Written in TypeScript
- Supports `maxSize` (byte-based eviction via `sizeCalculation`)
- Supports `ttl` (per-item or global TTL)
- Zero dependencies

**Configuration to match built-in:**
```typescript
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, string>({
  maxSize: 50 * 1024 * 1024, // 50MB
  sizeCalculation: (value) => Buffer.byteLength(value, 'utf8'),
  ttl: 15 * 60 * 1000, // 15 minutes
});
```

**Cache key strategy:**
- Built-in caches by URL (the result includes summarisation with a
  specific prompt, so same URL + different prompt = same cache entry
  if the previous result is still valid)
- For webfetch-plus: cache by URL only. If summarisation is enabled,
  cache the raw markdown pre-summarisation so different prompts can
  reuse the fetched content. Summarisation runs after cache lookup.
- This is more efficient than the built-in: fetch once, summarise per
  prompt. The built-in caches the summarised result, so same URL with
  different prompts causes a re-fetch.

### Trusted domain list - 2026-04-02

**Partial list recovered from reverse engineering (~60 of ~80):**

Language docs: docs.python.org, en.cppreference.com, docs.oracle.com,
learn.microsoft.com, developer.mozilla.org, go.dev, pkg.go.dev,
www.php.net, docs.swift.org, kotlinlang.org, ruby-doc.org,
doc.rust-lang.org, www.typescriptlang.org

Frontend: react.dev, angular.io, vuejs.org, nextjs.org, expressjs.com,
nodejs.org, jquery.com, getbootstrap.com, tailwindcss.com, d3js.org,
threejs.org, redux.js.org, webpack.js.org, jestjs.io, reactrouter.com

Python ecosystem: docs.djangoproject.com, flask.palletsprojects.com,
fastapi.tiangolo.com, pandas.pydata.org, numpy.org, www.tensorflow.org,
pytorch.org, scikit-learn.org, matplotlib.org,
requests.readthedocs.io, jupyter.org

PHP/Java/.NET: laravel.com, symfony.com, wordpress.org,
docs.spring.io, hibernate.org, tomcat.apache.org, gradle.org,
maven.apache.org, asp.net, dotnet.microsoft.com, nuget.org

Anthropic: platform.claude.com, code.claude.com,
modelcontextprotocol.io, github.com/anthropics

**Approach for webfetch-plus:**
- Ship with a curated list of ~80 domains (fill gaps with obvious
  candidates: kubernetes.io, docs.aws.amazon.com, graphql.org, etc.)
- Store as a simple Set in a separate module
- Make it easy to extend (nice-to-have: configurable via env or file)

## Assumptions

| # | Assumption | Confidence | Evidence | Consequence if wrong |
|---|-----------|-----------|---------|---------------------|
| 1 | AbortSignal.timeout works reliably on Node v24 | High | Stable since v21, undici#1926 resolved | Manual AbortController + setTimeout fallback |
| 2 | `redirect: 'manual'` returns Location header on Node v24 | High | Documented, matches Deno/CF Workers | Use undici directly for redirect interception |
| 3 | Built-in WebFetch hangs at JS promise level | Medium | No source, inferred from behaviour | AbortSignal still aborts regardless |
| 4 | defuddle + linkedom produces clean content extraction | High | Built by Obsidian team, site-specific extractors, actively maintained | Fall back to node-html-markdown for raw conversion |
| 5 | HTTP conditional requests (ETag/If-Modified-Since) work for most sites | Medium | Standard HTTP, but not all servers support it | Always re-download on cache hit if uncertain, which is the fallback anyway |
| 6 | Disk cache at ~/.claude/webfetch-plus/ is accessible to callers | High | Claude Code agents can Read any file path | If permissions block access, the tool is unusable regardless |

## Gap Analysis

No blocking gaps. All technology choices are decided. Implementation
can proceed.

## Summary

webfetch-plus replaces Claude Code's built-in WebFetch with a
timeout-safe MCP server. The design diverges from the built-in in
several ways informed by discovery:

**Architecture:**
- Built-in fetch + AbortSignal.timeout for the core problem (hangs)
- defuddle + linkedom for content extraction and HTML-to-markdown
  (replaces both Turndown and Haiku summarisation)
- Disk-based cache at ~/.claude/webfetch-plus/ with HTTP conditional
  request validation (replaces in-memory LRU with TTL)
- Tool returns metadata + file paths only, never inline content
- Content-type branching: HTML (defuddle), text/markdown/JSON/XML
  (as-is), binary (save + metadata)
- Matches built-in User-Agent string
- mcp-testing-kit + Vitest for testing

**Key departures from the built-in:**
1. No Haiku summarisation (defuddle cleans content algorithmically)
2. No inline content (file paths reduce token waste)
3. Disk cache with conditional validation (no TTL/size limits)
4. All content types handled (binary files saved to disk)

**Dependencies (MVP):**
- @modelcontextprotocol/sdk
- defuddle + linkedom
- mcp-testing-kit (dev)
- vitest (dev)
