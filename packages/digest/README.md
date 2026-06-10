# digest

An MCP server that fetches web pages through a real headless browser
(CloakBrowser, in Docker) and serves them back as structured Markdown — a
summary, the section outline, one named section, keywords, or the full
document. It replaces Claude Code's built-in WebFetch with a timeout-safe,
JavaScript-rendering alternative.

> Formerly published on npm as `webfetch-plus` (v0.1.x).

## Why

Claude Code's built-in WebFetch has no timeout and does not run JavaScript:
SPA/hydrated pages come back empty, bot-protected pages fail, and a fetch
that never returns hangs the agent. digest fixes all three:

- **Real rendering** — pages are loaded in a stealth Chromium, so
  JavaScript-rendered content is captured.
- **Hard timeout** — every fetch is bounded; the server cannot hang even if
  the browser does.
- **Structured output** — HTML is converted to clean Markdown with a
  heading index, so callers can read a summary or a single section instead
  of dumping the whole page into context.

## Requirements

- Docker (Desktop or Engine), running. The fetch engine is a local Docker
  image built from CloakBrowser.
- Node.js 22+.

## Installation

```sh
npx @mfassaie/digest setup      # build the local Docker image (~600 MB, one-time)
npx @mfassaie/digest install    # register the MCP server + block built-in WebFetch
```

Once installed globally (`npm i -g @mfassaie/digest`) the commands shorten to
`digest setup`, `digest install`, and `digest doctor`.

Then restart Claude Code. Check your environment any time with:

```sh
npx @mfassaie/digest doctor
```

`install` registers the MCP server in `.mcp.json`, adds a PreToolUse hook
that blocks the built-in WebFetch, and sets deny/allow permissions. Use
`--scope global` to apply to all projects, and `uninstall` to reverse it.

> The local image embeds CloakBrowser and is for your machine only — the
> CloakBrowser binary licence forbids redistributing it, so `setup` builds
> it locally and never pushes it anywhere.

### Manual MCP registration

```json
{
  "mcpServers": {
    "digest": {
      "command": "npx",
      "args": ["-y", "@mfassaie/digest"],
      "env": { "NODE_OPTIONS": "--use-system-ca" }
    }
  }
}
```

On Windows, `npx` must be wrapped with `cmd /c` (the installer does this):

```json
{
  "mcpServers": {
    "digest": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@mfassaie/digest"],
      "env": { "NODE_OPTIONS": "--use-system-ca" }
    }
  }
}
```

## Tools

### `fetch`

Fetches a URL through the browser, converts HTML to Markdown on disk, and
returns metadata, file paths and the section outline — never the page body
inline.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| uri | string | – | URL to fetch. HTTP auto-upgraded to HTTPS. |
| timeout_seconds | number | 30 | Hard timeout in seconds. |
| raw_only | boolean | false | Download HTML as-is without conversion. |

Non-HTML responses (PDFs, images, JSON, …) are downloaded and their path
returned; no conversion is attempted.

### `read`

Reads a previously fetched document from the cache. No network.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| uri | string | – | URL previously fetched with `fetch`. |
| mode | enum | sections | `summary` \| `sections` \| `keywords` \| `full`. |
| section | string | – | With `mode=sections`, return one section by slug or title. |

A typical loop: `fetch` a URL (see the outline cheaply), then `read` a summary
or a specific section. `full` returns the whole document and is opt-in.

## Configuration

Set via the MCP server's `env` block (or `install --document-root <path>` /
`install --repo <path>`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DIGEST_DOCUMENT_ROOT` | `~/.claude/digest` | Base dir holding `cache/` and `logs/`. Each session may set its own. |
| `DIGEST_REPO_ROOT` | – | If set, runs the server from the repo source under a file watcher (dev mode). |

Different sessions can point at different document roots safely — the shared
container is document-root-agnostic and the host writes into the configured
root.

## How it works

```
Claude Code ──stdio──> digest MCP server (host)        [per session]
                         starts/uses ONE shared container, calls it over HTTP
                         writes cache + logs to this session's document root
                         ▼
        container (local image, built by `setup`)
          CloakBrowser (CDP) + a fetch/convert service
          renders the page, converts to Markdown, RETURNS the content
```

The MCP server auto-starts the shared container on first use and reports a
clear error (no silent fallback) if Docker or the image is missing. The
container fetches and converts and returns the content; the host writes it
into the document root, so one shared container serves all sessions.

### Cache and logs

Under `DIGEST_DOCUMENT_ROOT` (default `~/.claude/digest`):
- `cache/<domain>/<sha256(url)>/`: `raw.<ext>`, `content.md`,
  `structure.json` (heading index), `meta.json` (ETag, Last-Modified,
  document metadata). Repeat fetches are revalidated with conditional
  requests (ETag / If-Modified-Since).
- `logs/`: `digest-server.log` (the host server) and `cloakbrowser.log`
  (the container: cloakserve / CloakBrowser).

### Dev mode

Set `DIGEST_REPO_ROOT` to the `packages/digest` directory of a clone, and the
server runs from `src/` under `tsx --watch`, hot-reloading on edits (the
container image is unchanged unless its dependencies change). A reload
re-initialises the MCP server, so the client re-handshakes.

## Development

```sh
git clone https://github.com/mfassaie/digest.git
cd digest
pnpm install
pnpm build
pnpm test
```

This is a pnpm workspace (see the [repo root README](../../README.md)):
`packages/digest` is the published MCP server (`@mfassaie/digest`),
`packages/container` is the in-image service, and `packages/eval` is the
converter eval harness (`pnpm --filter @digest/eval run all`).

## Licence

[MIT](LICENSE) for this project's code. The CloakBrowser base image is
proprietary (free to use, no redistribution); the derived image is built
locally and never published.
