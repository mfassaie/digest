# Interfaces

## MCP Tool Interface

Server key: `digest` (stdio transport). Tools surface to the model as
`mcp__digest__fetch` and `mcp__digest__read`.

### `fetch`

Fetches a URL through the headless browser, converts HTML to structured
Markdown on disk, and returns metadata, file paths and the section outline.
Never returns the document body inline (ADR-003, scoped by ADR-008).

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| uri | string | yes | - | URL to fetch. HTTP auto-upgraded to HTTPS. |
| timeout_seconds | number | no | 30 | Hard timeout in seconds. |
| raw_only | boolean | no | false | Download HTML as-is, no conversion. |

Non-HTML responses (PDF, images, JSON, ...) are downloaded and their path
returned; no conversion is attempted.

**Response (success):** metadata, file paths, and a heading outline.

```
URL: https://example.com/docs/api
Final URL: https://example.com/docs/api
Status: 200
Content-Type: text/html
Title: API Documentation
Author: Jane Roe
Published: 2026-01-15
Word count: 4472

Files:
  markdown: ~/.claude/digest/cache/<domain>/<hash>/content.md
  raw: ~/.claude/digest/cache/<domain>/<hash>/raw.html

Size: 45.2 KB (markdown) | 128.7 KB (raw)
Fetched: 2026-06-10T14:30:00Z
Source: fresh | cache (validated)

Sections (3):
  - Overview [overview]
    - Parameters [parameters]
  - Errors [errors]
```

**Response (error):** returned with `isError: true`.

```
Error fetching https://example.com/unreachable
Reason: Timeout after 30 seconds
```

**Response (cross-host redirect):**

```
Redirect detected (cross-host):
  From: https://old.example.com/docs
  To: https://new.example.com/docs

Make a new request with the redirect URL to fetch the content.
```

### `read`

Reads a previously fetched document from the cache. No network.

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| uri | string | yes | - | URL previously fetched with `fetch`. |
| mode | enum | no | sections | `summary` \| `sections` \| `keywords` \| `full`. |
| section | string | no | - | With `mode=sections`, one section by slug or title. |

`summary` returns an extractive summary (plus the document description),
`sections` the outline or a named section, `keywords` the top terms, `full`
the whole Markdown (the only unbounded mode). A missing cache entry returns
an error directing the caller to run `fetch` first.

## CLI Interface

```
digest setup                              Build the local Docker image
digest doctor                             Check Docker, image and cache
digest install   [--scope project|global] Register the MCP server
digest uninstall [--scope project|global] Remove the MCP server
digest --help | --version
```

With no subcommand, starts the MCP server on stdio. From the registry the
commands are `npx @mfassaie/digest <subcommand>`.

**Project scope** writes to: `cwd/.mcp.json`, `cwd/.claude/settings.json`,
`cwd/.claude/settings.local.json`.
**Global scope** writes to: `~/.claude.json`, `~/.claude/settings.json`,
`~/.claude/settings.local.json`.

Exit codes: 0 (success), 1 (error).

## Container service (internal)

The host talks to an in-image HTTP service (not user-facing):
`GET /healthz` → `{ status, cdpConnected, version }`; `POST /fetch`
→ `{ outcome: fetched | not-modified | cross-host-redirect | http-error }`
or 504 timeout / 502 fetch-failed. See ADR-007.

## External APIs

None. Summarisation is local/extractive (no LLM); the read engine is
pluggable (ADR-006 follow-up).
