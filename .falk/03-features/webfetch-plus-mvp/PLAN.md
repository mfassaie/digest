# Plan: webfetch-plus MVP

## Wave 0 - Setup (sequential)

### TASK-W0-001: Project scaffolding
- **Size:** S
- **Description:** Create package.json (ESM, type: module), tsconfig.json, vitest.config.ts, .gitignore, build script (tsc). Configure pnpm.
- **Test type:** None
- **Dependencies:** None

### TASK-W0-002: Install dependencies
- **Size:** S
- **Description:** Install runtime deps (@modelcontextprotocol/sdk, defuddle, linkedom) and dev deps (vitest, mcp-testing-kit, typescript, @types/node).
- **Test type:** None
- **Dependencies:** TASK-W0-001

### TASK-W0-003: Shared types module
- **Size:** S
- **Spec IDs:** (supports all)
- **Description:** Create src/types.ts with FetchRequest, FetchResult, CacheEntry, CacheMeta, ContentCategory types.
- **Test type:** None
- **Dependencies:** TASK-W0-002

## Wave 1 - Unit tests / INV (parallel)

### TASK-W1-001: URL normalisation
- **Size:** S
- **Spec IDs:** INV-002
- **Description:** Implement HTTPS upgrade in fetcher.ts. Test that http:// URLs are rewritten to https:// before any fetch call.
- **Test type:** Unit
- **Dependencies:** TASK-W0-003

### TASK-W1-002: Fetch with timeout
- **Size:** M
- **Spec IDs:** INV-001
- **Description:** Implement fetch wrapper in fetcher.ts using AbortSignal.timeout. Test that fetch aborts after timeout_seconds, throws a recognisable error. Mock global fetch.
- **Test type:** Unit
- **Dependencies:** TASK-W0-003

### TASK-W1-003: Redirect handling
- **Size:** M
- **Spec IDs:** INV-003, INV-004
- **Description:** Implement redirect detection in fetcher.ts using redirect: 'manual'. Test cross-host redirects are blocked and reported. Test same-host redirects are followed up to 5 hops. Mock global fetch with redirect responses.
- **Test type:** Unit
- **Dependencies:** TASK-W0-003

### TASK-W1-004: Cache operations
- **Size:** M
- **Spec IDs:** INV-005
- **Description:** Implement cache.ts: getCacheDir (domain/url-hash), readMeta, writeMeta, writeRaw, writeMarkdown, hasCacheEntry. Test that every cache write produces a meta.json. Use tmp directory in tests.
- **Test type:** Unit
- **Dependencies:** TASK-W0-003

### TASK-W1-005: Content-type branching
- **Size:** M
- **Spec IDs:** INV-006, INV-007
- **Description:** Implement converter.ts: classifyContentType, convertHtml (defuddle + linkedom), saveContent. Test HTML produces both raw.html and content.md. Test binary content is saved without markdown conversion. Test JSON is pretty-printed. Mock defuddle in unit tests.
- **Test type:** Unit
- **Dependencies:** TASK-W0-003

### TASK-W1-006: Response formatting
- **Size:** S
- **Spec IDs:** INV-008
- **Description:** Implement response.ts: formatSuccess, formatError, formatRedirect. Test that success responses contain only metadata and file paths, never page content. Test error and redirect formats match API specs.
- **Test type:** Unit
- **Dependencies:** TASK-W0-003

## Wave 2 - Contract tests / API (parallel)

### TASK-W2-001: Tool schema contract
- **Size:** S
- **Spec IDs:** API-001
- **Description:** Implement server.ts: MCP server setup, tool registration with correct schema. Test via mcp-testing-kit that the server advertises webfetch_plus with url (required), prompt (optional), timeout_seconds (optional, default 30).
- **Test type:** Contract
- **Dependencies:** TASK-W1-002, TASK-W1-006

### TASK-W2-002: Success response contract
- **Size:** S
- **Spec IDs:** API-002
- **Description:** Test that a successful fetch returns response matching the API-002 format: URL, Status, Content-Type, Title, Files section with paths, Size, Fetched timestamp, Source indicator.
- **Test type:** Contract
- **Dependencies:** TASK-W1-006

### TASK-W2-003: Error response contract
- **Size:** S
- **Spec IDs:** API-003
- **Description:** Test that errors return isError: true with message matching API-003 format. Cover timeout and HTTP error status codes.
- **Test type:** Contract
- **Dependencies:** TASK-W1-006

### TASK-W2-004: Redirect response contract
- **Size:** S
- **Spec IDs:** API-004
- **Description:** Test that cross-host redirects return response matching API-004 format with From/To URLs and instruction to re-request.
- **Test type:** Contract
- **Dependencies:** TASK-W1-003, TASK-W1-006

## Wave 3 - Acceptance tests / SPEC (parallel)

### TASK-W3-001: Fetch HTML end-to-end
- **Size:** L
- **Spec IDs:** SPEC-001
- **Description:** Wire all modules together in server.ts tool handler. Test full flow: call tool with HTML URL, verify defuddle extraction runs, raw.html and content.md written to cache, response contains correct metadata and file paths. Mock fetch with realistic HTML response.
- **Test type:** Acceptance
- **Dependencies:** All Wave 1 + Wave 2 tasks

### TASK-W3-002: Timeout end-to-end
- **Size:** M
- **Spec IDs:** SPEC-002
- **Description:** Test full flow: call tool with URL that never responds, verify tool returns error within timeout, no cache entry created. Mock fetch with a never-resolving promise.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-001

### TASK-W3-003: Redirect end-to-end
- **Size:** M
- **Spec IDs:** SPEC-003
- **Description:** Test full flow: call tool with cross-host redirect URL, verify redirect notice returned. Call tool with same-host redirect URL, verify content from final destination returned.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-001

### TASK-W3-004: Content-type branching end-to-end
- **Size:** L
- **Spec IDs:** SPEC-004
- **Description:** Test full flow for each content type: HTML (defuddle), text/plain (as-is), application/json (pretty-print), application/pdf (binary save). Verify correct files created and response format for each.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-001

### TASK-W3-005: Cache validation end-to-end
- **Size:** L
- **Spec IDs:** SPEC-005
- **Description:** Test full flow: first call creates cache entry with meta.json. Second call sends conditional request. Mock 304 response and verify cached files returned. Mock 200 response and verify cache updated.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-001

### TASK-W3-006: MCP server lifecycle
- **Size:** M
- **Spec IDs:** SPEC-006
- **Description:** Test via mcp-testing-kit: connect to server, list tools, verify webfetch_plus is advertised with correct schema, make a tool call, verify response.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-001

## Wave 4 - NFR (parallel)

### TASK-W4-001: Timeout reliability
- **Size:** S
- **Spec IDs:** NFR-001
- **Description:** Test that fetch abort occurs within timeout_seconds + 1s tolerance. Use a mock server that never responds. Measure elapsed time. Verify no unsettled promises.
- **Test type:** Performance
- **Dependencies:** TASK-W1-002

### TASK-W4-002: Cache I/O performance
- **Size:** S
- **Spec IDs:** NFR-002
- **Description:** Benchmark cache read/write with 1MB payload. Assert < 100ms for both operations.
- **Test type:** Performance
- **Dependencies:** TASK-W1-004

### TASK-W4-003: Startup time
- **Size:** S
- **Spec IDs:** NFR-003
- **Description:** Measure time from server process start to first successful tool call via mcp-testing-kit. Assert < 2 seconds.
- **Test type:** Performance
- **Dependencies:** TASK-W3-006

## Coverage Matrix

| Spec ID  | Covering task(s) |
|----------|-----------------|
| SPEC-001 | TASK-W3-001     |
| SPEC-002 | TASK-W3-002     |
| SPEC-003 | TASK-W3-003     |
| SPEC-004 | TASK-W3-004     |
| SPEC-005 | TASK-W3-005     |
| SPEC-006 | TASK-W3-006     |
| API-001  | TASK-W2-001     |
| API-002  | TASK-W2-002     |
| API-003  | TASK-W2-003     |
| API-004  | TASK-W2-004     |
| INV-001  | TASK-W1-002     |
| INV-002  | TASK-W1-001     |
| INV-003  | TASK-W1-003     |
| INV-004  | TASK-W1-003     |
| INV-005  | TASK-W1-004     |
| INV-006  | TASK-W1-005     |
| INV-007  | TASK-W1-005     |
| INV-008  | TASK-W1-006     |
| NFR-001  | TASK-W4-001     |
| NFR-002  | TASK-W4-002     |
| NFR-003  | TASK-W4-003     |

All 21 spec IDs covered. No gaps.

## Audit

### Gate Verdict
READY

### Audit Notes
- **Coverage:** All 21 spec IDs covered, no gaps
- **Dependencies:** No circular dependencies, wave ordering correct (0->1->2->3->4)
- **Scope:** Tasks match spec boundaries, no scope creep, no deferred items included
- **Architecture:** All three ADRs respected (no Haiku, disk cache, file paths only)
- **Risk:** defuddle is medium-risk (newer library), mitigated by mocking in unit tests and graceful degradation
- **Codebase:** Greenfield, no conflicts

### Audit Date
2026-04-02

## Implementation Audit

### Gate Verdict
COMPLETE

### Audit Summary
- **Wave completeness:** All waves (0-4) complete, 22 tasks implemented
- **Test suite:** 74 tests, 100% pass rate, 448ms
- **Spec coverage:** All 21 spec IDs covered by passing tests
- **Code coverage:** 92% line, 79% branch, 88% function
- **Build:** TypeScript compiles cleanly, no type errors
- **Deviations:** None. zod added as dependency (MCP SDK peer dep, not in original plan)

### Audit Date
2026-04-02
