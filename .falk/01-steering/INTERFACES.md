# Interfaces

## MCP Tool Interface

### webfetch_plus

**Transport:** stdio

**Parameters:**

| Name            | Type   | Required | Default | Description                              |
|-----------------|--------|----------|---------|------------------------------------------|
| url             | string | yes      | -       | URL to fetch. HTTP auto-upgraded to HTTPS. |
| prompt          | string | no       | -       | Context for the fetch (accepted for compatibility, currently unused). |
| timeout_seconds | number | no       | 30      | Hard timeout in seconds.                 |

**Response (success):**

Returns metadata and file paths only. No inline content. See ADR-003.

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

**Response (error):**

Returned with `isError: true`.

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

## External APIs

None for MVP. Haiku summarisation deferred (ADR-001).
