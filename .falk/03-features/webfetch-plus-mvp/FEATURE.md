# Feature: webfetch-plus MVP

## Scope

### Boundaries

**In scope:**
- MCP server (stdio transport) exposing `webfetch_plus` tool
- Hard timeout via AbortSignal.timeout (default 30s)
- HTML content extraction via defuddle + linkedom, output as markdown
- Content-type branching (HTML, text, JSON, XML, binary)
- HTTP-to-HTTPS auto-upgrade
- Cross-host redirect detection and reporting
- Disk-based cache at ~/.claude/webfetch-plus/cache/
- Save both raw response and converted markdown
- HTTP conditional request cache validation (ETag / If-Modified-Since)
- Tool returns metadata + file paths only, never inline content
- Browser-compatible User-Agent matching built-in WebFetch

**Out of scope:**
- Haiku summarisation (deferred, see ADR-001)
- Trusted domain list (only useful with summarisation)
- Cache size limits / eviction policy
- Rate limiting
- JavaScript-rendered pages (SPA)
- Configurable User-Agent
- Configurable cache location

**Anti-goals:**
- Not a general-purpose web scraper
- Not improving on the built-in's content quality
- Not handling authentication or cookies

### Constraints

| Constraint | Detail |
|-----------|--------|
| Platform | TypeScript, Node.js v24+, ESM |
| Transport | MCP stdio only (no HTTP/SSE) |
| Dependencies | Minimal: @modelcontextprotocol/sdk, defuddle, linkedom |
| Deployment | Local MCP server registered in Claude Code config |
| Compatibility | Must accept same parameters as built-in WebFetch (url, prompt) so callers do not need modification |

### Dependencies

| Dependency | Type | Risk |
|-----------|------|------|
| @modelcontextprotocol/sdk | Runtime | Low. Official SDK, stable. |
| defuddle + linkedom | Runtime | Medium. defuddle is newer, but actively maintained by Obsidian team. |
| Node.js built-in fetch | Runtime | Low. Stable since v21, part of core. |
| ~/.claude/ directory | Filesystem | Low. Exists on any machine with Claude Code installed. |
| mcp-testing-kit | Dev only | Low. Lightweight, Vitest-compatible. |

### Feasibility

No show-stoppers. All technology choices validated during Discovery.
Core risk is defuddle's content extraction quality on edge-case HTML,
but this degrades gracefully (messy markdown is still usable, unlike
a hung agent which is not).

### ADRs

- ADR-001: Skip Haiku summarisation
- ADR-002: Disk-based cache with conditional validation
- ADR-003: File paths only, no inline content

## Define

### Behaviour

#### SPEC-001: Fetch HTML page and return file paths

```gherkin
Given a URL pointing to an HTML page
When the tool is called with that URL
Then the page is fetched with the configured User-Agent
And the HTML is extracted and converted to markdown via defuddle
And both raw HTML and markdown are saved to disk
And the response contains metadata and file paths only
```

**Business rules:**
- HTTP URLs are auto-upgraded to HTTPS before fetching
- Response must include: url, status, content-type, title (if HTML),
  file paths (raw + markdown), file sizes, fetch timestamp

#### SPEC-002: Hard timeout prevents hangs

```gherkin
Given a URL that does not respond within the timeout period
When the tool is called with timeout_seconds=N
Then the fetch is aborted after N seconds
And an error message is returned (not a hang)
And no files are saved to the cache
```

**Business rules:**
- Default timeout is 30 seconds
- Timeout is enforced via AbortSignal.timeout
- On timeout, return isError: true with a clear message including
  the URL and timeout duration

#### SPEC-003: Cross-host redirect detection

```gherkin
Given a URL that redirects to a different host
When the tool is called with that URL
Then the redirect is detected but not followed
And the response reports the redirect target URL
And the caller can make a new request to the target
```

```gherkin
Given a URL that redirects to the same host
When the tool is called with that URL
Then the redirect is followed automatically
And the final content is returned as normal
```

**Business rules:**
- Use fetch with redirect: 'manual'
- Compare source host and Location header host
- Same-host: re-fetch the redirect target (follow up to 5 hops)
- Cross-host: return a notice with the target URL, do not follow

#### SPEC-004: Content-type branching

```gherkin
Given a URL that returns Content-Type: text/html
When the tool is called
Then defuddle extracts main content and converts to markdown
And both raw HTML and markdown files are saved
```

```gherkin
Given a URL that returns Content-Type: text/plain or text/markdown
When the tool is called
Then the content is saved as-is (no conversion needed)
And the raw file path is returned
```

```gherkin
Given a URL that returns Content-Type: application/json
When the tool is called
Then the JSON is pretty-printed and saved
And the raw file path is returned
```

```gherkin
Given a URL that returns a binary Content-Type (PDF, image, etc.)
When the tool is called
Then the binary file is saved to disk
And the response contains metadata and the file path
And no markdown conversion is attempted
```

**Business rules:**
- Branching is based on the Content-Type response header
- HTML types: text/html, application/xhtml+xml
- Text types: text/plain, text/markdown, text/xml, application/xml
- JSON types: application/json
- Everything else: treated as binary

#### SPEC-005: Disk cache with conditional validation

```gherkin
Given a URL that has been fetched before (cache hit)
When the tool is called for the same URL
Then a conditional HTTP request is sent (If-None-Match / If-Modified-Since)
And if the server returns 304, the cached files are returned
And if the server returns 200, the cache is updated with new content
```

```gherkin
Given a URL that has never been fetched (cache miss)
When the tool is called
Then the content is fetched and saved to cache
And meta.json is created with ETag, Last-Modified, and timestamp
```

**Business rules:**
- Cache key is the normalised URL (after HTTPS upgrade)
- Cache directory structure: ~/.claude/webfetch-plus/cache/<domain>/<url-hash>/
- Each cache entry contains: raw.<ext>, content.md (if applicable), meta.json
- meta.json stores: url, etag, lastModified, contentType, fetchedAt
- If server does not support conditional requests (no ETag or
  Last-Modified in original response), always re-fetch

#### SPEC-006: MCP server lifecycle

```gherkin
Given the MCP server is started via stdio
When Claude Code connects
Then the server advertises the webfetch_plus tool
And the tool schema matches the defined parameters
```

**Business rules:**
- Single tool: webfetch_plus
- Parameters: url (string, required), prompt (string, optional),
  timeout_seconds (number, optional, default 30)
- Server uses @modelcontextprotocol/sdk StdioServerTransport

### Interface

#### API-001: webfetch_plus tool schema

**Parameters:**

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "URL to fetch. HTTP auto-upgraded to HTTPS."
    },
    "prompt": {
      "type": "string",
      "description": "Context for the fetch (accepted for compatibility, currently unused)."
    },
    "timeout_seconds": {
      "type": "number",
      "description": "Hard timeout in seconds. Default 30.",
      "default": 30
    }
  },
  "required": ["url"]
}
```

#### API-002: Success response format

```
URL: https://example.com/docs/api
Status: 200
Content-Type: text/html
Title: API Documentation

Files:
  markdown: <cache-path>/content.md
  raw: <cache-path>/raw.html

Size: 45.2 KB (markdown) | 128.7 KB (raw)
Fetched: 2026-04-02T14:30:00Z
Source: cache (validated) | fresh
```

#### API-003: Error response format

Returned with `isError: true` in the MCP response.

```
Error fetching https://example.com/unreachable
Reason: Timeout after 30 seconds
```

```
Error fetching https://example.com/missing
Reason: HTTP 404 Not Found
```

#### API-004: Cross-host redirect response format

```
Redirect detected (cross-host):
  From: https://old.example.com/docs
  To: https://new.example.com/docs

Make a new request with the redirect URL to fetch the content.
```

### Domain

#### Entities

| Entity | Description |
|--------|------------|
| FetchRequest | Validated URL + timeout + prompt. URL normalised (HTTPS). |
| FetchResult | Status, content-type, headers, body (raw bytes). |
| CacheEntry | Directory on disk containing raw file, markdown file (if applicable), and meta.json. |
| CacheMeta | ETag, Last-Modified, content-type, url, fetchedAt. |

#### Invariants

| ID | Invariant | Test type |
|----|-----------|-----------|
| INV-001 | A fetch must complete or abort within timeout_seconds | Unit |
| INV-002 | HTTP URLs are always upgraded to HTTPS before fetching | Unit |
| INV-003 | Cross-host redirects are never followed automatically | Unit |
| INV-004 | Same-host redirects are followed up to 5 hops | Unit |
| INV-005 | Cache entries always contain meta.json | Unit |
| INV-006 | HTML content produces both raw and markdown files | Unit |
| INV-007 | Binary content is saved without markdown conversion | Unit |
| INV-008 | Tool response never contains page content inline | Unit |

### Technical Design

#### Components

```
src/
  index.ts              # MCP server entry point
  server.ts             # Server setup, tool registration
  fetcher.ts            # Fetch with timeout, redirect handling, HTTPS upgrade
  converter.ts          # Content-type branching, defuddle extraction
  cache.ts              # Disk cache read/write, conditional validation
  response.ts           # Format tool responses (metadata + paths)
  types.ts              # Shared types
```

#### Data flow

```
Tool call (url, prompt, timeout_seconds)
  |
  v
Normalise URL (HTTP -> HTTPS)
  |
  v
Check disk cache (meta.json exists?)
  |-- Cache hit: conditional fetch (If-None-Match / If-Modified-Since)
  |     |-- 304: return cached file paths
  |     |-- 200: update cache, return new file paths
  |-- Cache miss: full fetch
  |
  v
Fetch with AbortSignal.timeout
  |
  v
Check redirect (manual mode)
  |-- Cross-host: return redirect notice
  |-- Same-host: follow (up to 5 hops), then continue
  |
  v
Branch on Content-Type
  |-- HTML: defuddle extract -> save raw.html + content.md
  |-- Text/Markdown/XML: save raw file
  |-- JSON: pretty-print, save raw.json
  |-- Binary: save raw file
  |
  v
Write meta.json (etag, last-modified, content-type, url, timestamp)
  |
  v
Format response (metadata + file paths)
  |
  v
Return to caller
```

#### Technology choices

| Component | Choice | Source |
|-----------|--------|--------|
| HTTP client | Built-in fetch | Discovery decision 1 |
| Content extraction | defuddle + linkedom | Discovery decision 2 |
| MCP framework | @modelcontextprotocol/sdk | Scope constraint |
| Cache | Filesystem (no library) | Discovery decision 5 |
| Test framework | Vitest + mcp-testing-kit | Discovery decision 8 |

### Quality

#### NFR-001: Timeout reliability

Every fetch must abort within timeout_seconds + 1s tolerance.
No promise may remain unsettled after timeout.
Test: unit test with a mock server that never responds.

#### NFR-002: Cache I/O performance

Disk cache operations (read meta.json, write files) should complete
in < 100ms for typical page sizes (< 1MB).
Test: benchmark test with representative payloads.

#### NFR-003: Startup time

MCP server should be ready to accept tool calls within 2 seconds
of process start.
Test: integration test measuring time to first tool call.

### Traceability

| ID | Source | Test type | Description |
|----|--------|-----------|-------------|
| SPEC-001 | Discovery summary | Acceptance | Fetch HTML, return file paths |
| SPEC-002 | Problem statement | Acceptance | Hard timeout prevents hangs |
| SPEC-003 | Discovery decision 1 | Acceptance | Cross-host redirect detection |
| SPEC-004 | Discovery decision 7 | Acceptance | Content-type branching |
| SPEC-005 | Discovery decisions 5,6 | Acceptance | Disk cache with conditional validation |
| SPEC-006 | Scope constraint | Acceptance | MCP server lifecycle |
| API-001 | Scope compatibility | Contract | Tool schema |
| API-002 | Discovery decision 5 | Contract | Success response format |
| API-003 | Problem statement | Contract | Error response format |
| API-004 | Discovery decision 1 | Contract | Redirect response format |
| INV-001 | Problem statement | Unit | Timeout enforcement |
| INV-002 | CLAUDE.md requirement | Unit | HTTPS upgrade |
| INV-003 | CLAUDE.md requirement | Unit | Cross-host redirect block |
| INV-004 | CLAUDE.md requirement | Unit | Same-host redirect follow |
| INV-005 | ADR-002 | Unit | Cache meta.json exists |
| INV-006 | Discovery decision 7 | Unit | HTML produces both files |
| INV-007 | Discovery decision 7 | Unit | Binary saved without conversion |
| INV-008 | ADR-003 | Unit | No inline content |
| NFR-001 | Problem statement | Performance | Timeout reliability |
| NFR-002 | ADR-002 | Performance | Cache I/O |
| NFR-003 | Scope | Performance | Startup time |

## Review

Gate Verdict: PASS

| Check | Result | Notes |
|-------|--------|-------|
| Completeness | Pass | All sections present, 6 specs, 4 APIs, 8 invariants, 3 NFRs |
| Testability | Pass | Every ID has automatable test type assigned |
| Consistency | Pass | ADRs, specs, and response formats aligned |
| Traceability | Pass | All 21 IDs linked to Discovery or Scope source |

Three-perspective review:
- User: agents get file paths, timeouts prevent hangs, redirects reported clearly
- Developer: clean module boundaries, standard tech, testable with mocked fetch
- Business: solves 75% hung-agent problem, no API costs, simple deployment

Specification locked. Ready for Plan.
