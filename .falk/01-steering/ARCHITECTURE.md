# Architecture

## Technology Stack

| Component       | Choice                        |
|-----------------|-------------------------------|
| Language        | TypeScript                    |
| Runtime         | Node.js v24+                  |
| Package manager | pnpm                          |
| Transport       | MCP stdio                     |

## Key Dependencies

| Package                      | Purpose                           |
|------------------------------|-----------------------------------|
| @modelcontextprotocol/sdk    | MCP server framework              |
| defuddle                     | Content extraction + HTML cleanup |
| linkedom                     | DOM implementation for defuddle   |

## Design Overview

The server exposes a single `webfetch_plus` tool via MCP stdio transport.
It fetches web pages with a hard timeout, extracts main content via
defuddle, converts to Markdown, and saves both raw and converted files
to a disk-based cache. The tool returns metadata and file paths only,
never inline content. See ADR-003.

### Entry Point Routing

The binary (`index.ts`) is dual-mode (see ADR-005):
- `webfetch-plus install [--scope project|global]` registers the MCP server
- `webfetch-plus uninstall [--scope project|global]` removes the registration
- `webfetch-plus --help` / `--version` prints info and exits
- No args: starts the MCP server on stdio (backwards compatible)

### Install/Uninstall Flow

1. Parse subcommand and --scope from process.argv
2. Resolve config file paths (project scope: cwd, global scope: ~/.claude)
3. For install: create/merge .mcp.json, .claude/settings.json, .claude/settings.local.json
4. For uninstall: remove entries, clean up empty files and directories

### MCP Server Request Flow

1. Receive tool call with `url`, `prompt` (optional), `timeout_seconds`
2. Normalise URL (HTTP to HTTPS upgrade)
3. Check disk cache for existing entry (meta.json)
4. If cached: send conditional HTTP request (If-None-Match / If-Modified-Since)
   - 304 Not Modified: return cached file paths
   - 200: update cache with new content
5. If not cached: full fetch with AbortSignal.timeout
6. Check for redirects (manual mode)
   - Same-host: follow (up to 5 hops)
   - Cross-host: return redirect notice, do not follow
7. Branch on Content-Type
   - HTML: defuddle extract, save raw.html + content.md
   - Text/Markdown/XML: save as-is
   - JSON: pretty-print, save raw.json
   - Binary: save raw file
8. Write meta.json (etag, last-modified, content-type, url, timestamp)
9. Return metadata + file paths to caller

## Module Boundaries

```
src/
  index.ts              # Dual-mode entry point: CLI subcommands or MCP server
  server.ts             # Server setup, tool registration
  fetcher.ts            # Fetch with timeout, redirect handling, HTTPS upgrade
  converter.ts          # Content-type branching, defuddle extraction
  cache.ts              # Disk cache read/write, conditional validation
  response.ts           # Format tool responses (metadata + paths)
  cli.ts                # CLI arg parsing and usage output
  cli-install.ts        # Install: create/merge MCP config, hook, permissions
  cli-uninstall.ts      # Uninstall: remove entries, clean up empty files
  cli-config.ts         # Config file path resolution (project vs global scope)
  cli-json.ts           # JSON file read/write/merge utilities
  types.ts              # Shared types (server + CLI)
```

## Cache Architecture

Disk-based cache at `~/.claude/webfetch-plus/cache/`. See ADR-002.

```
~/.claude/webfetch-plus/
  cache/
    <domain>/
      <url-hash>/
        raw.<ext>       # Original response body
        content.md      # Converted markdown (text types only)
        meta.json       # Headers, ETag, Last-Modified, timestamp
```

No max cache size for MVP. Validation via HTTP conditional requests.
