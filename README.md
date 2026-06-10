# webfetch-plus

Timeout-safe MCP server replacing Claude Code's built-in WebFetch.

## Problem

Claude Code's built-in WebFetch has no timeout. When a subagent calls
WebFetch and the fetch never completes, the subagent hangs forever and
the parent agent has no recovery path. Analysis of 235 subagent logs
showed 75% of hung subagents died on a WebFetch call.

## Features

- Hard timeout (default 30s) prevents agent hangs
- HTML content extraction and markdown conversion via defuddle
- Disk-based cache with HTTP conditional validation (ETag / If-Modified-Since)
- Content-type branching (HTML, text, JSON, XML, binary)
- HTTP to HTTPS auto-upgrade
- Cross-host redirect detection and reporting
- Same-host redirects followed automatically (up to 5 hops)
- Returns metadata and file paths only, never inline content
- CLI install and uninstall for project or global scope

## Installation

### Quick

```sh
npx webfetch-plus install
```

This registers the MCP server, adds a PreToolUse hook to block the
built-in WebFetch, and configures deny/allow permissions in your
project's Claude Code config.

### Manual

Add the following to your `.mcp.json`:

```json
{
  "mcpServers": {
    "webfetch-plus": {
      "command": "npx",
      "args": ["-y", "webfetch-plus"],
      "env": { "NODE_OPTIONS": "--use-system-ca" }
    }
  }
}
```

On Windows, `npx` must be wrapped with `cmd /c` (the installer does
this automatically):

```json
{
  "mcpServers": {
    "webfetch-plus": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "webfetch-plus"],
      "env": { "NODE_OPTIONS": "--use-system-ca" }
    }
  }
}
```

### Global install

To install for all projects (user-level config):

```sh
npx webfetch-plus install --scope global
```

### Uninstall

```sh
npx webfetch-plus uninstall
```

For global scope, add `--scope global`.

## Configuration

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| url | string | yes | - | URL to fetch. HTTP auto-upgraded to HTTPS. |
| prompt | string | no | - | Context for the fetch (accepted for compatibility, currently unused). |
| timeout_seconds | number | no | 30 | Hard timeout in seconds. |

### Cache location

Cached responses are stored at `~/.claude/webfetch-plus/cache/`. Each
entry contains the raw response, converted markdown (for HTML), and
a `meta.json` file with ETag, Last-Modified, and fetch timestamp.

## Usage

The tool returns metadata and file paths. It never includes page
content inline. A typical response looks like:

```
URL: https://example.com/docs/api
Status: 200
Content-Type: text/html
Title: API Documentation

Files:
  markdown: ~/.claude/webfetch-plus/cache/example.com/<hash>/content.md
  raw: ~/.claude/webfetch-plus/cache/example.com/<hash>/raw.html

Size: 45.2 KB (markdown) | 128.7 KB (raw)
Fetched: 2026-04-02T14:30:00Z
Source: fresh
```

On error, the tool returns `isError: true` with a reason:

```
Error fetching https://example.com/unreachable
Reason: Timeout after 30 seconds
```

Cross-host redirects are reported without following:

```
Redirect detected (cross-host):
  From: https://old.example.com/docs
  To: https://new.example.com/docs

Make a new request with the redirect URL to fetch the content.
```

## Development

```sh
git clone https://github.com/mfassaie/webfetch-plus.git
cd webfetch-plus
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Licence

[MIT](LICENSE)
