# ADR-002: Disk-based cache with conditional validation

## Status

Accepted

## Context

The built-in WebFetch uses an in-memory LRU cache (50MB, 15-min TTL).
This means cached content is lost on process restart and limited by
memory.

webfetch-plus runs as a persistent MCP server. Disk-based caching
allows cache survival across restarts and removes memory pressure.
HTTP conditional requests (If-None-Match / If-Modified-Since) provide
smarter cache validation than a fixed TTL: the origin server decides
whether content has changed.

## Decision

Cache all fetched content to disk at ~/.claude/webfetch-plus/cache/.
Store both raw response and converted markdown. On cache hit, send a
conditional HTTP request. Serve cached files on 304 Not Modified.
Re-download on 200 or when conditional headers are not available.
No max cache size for MVP.

## Consequences

- Cache persists across server restarts
- No memory pressure from cached content
- Smarter invalidation than fixed TTL (server-driven)
- Disk usage grows unbounded (acceptable for MVP, add eviction later)
- Slightly more complex than in-memory cache (filesystem operations)
