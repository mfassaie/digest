# digest

An MCP server that fetches files into a structured artefact store, converts
supported formats (markdown, HTML) to a typed section tree with sticky ids and
hash-based locking, and serves content through four tools. HTML pages render in
a stealth headless browser (CloakBrowser, in Docker) when the pipeline rule
requires it; markdown and plain downloads run entirely in-process.

> Formerly published on npm as `webfetch-plus` (v0.1.x). v0.4.0 is a breaking
> release: tools renamed, artefact store replaces the old cache layout, settings
> engine added.

## Why

Claude Code's built-in WebFetch has no timeout and does not run JavaScript:
SPA/hydrated pages come back empty, bot-protected pages fail, and a fetch
that never returns hangs the agent. digest fixes all three:

- **No hang** -- every fetch is bounded by a host-side abort; the MCP server
  cannot hang even if the browser does.
- **Real rendering** -- HTML pages load in stealth Chromium when the pipeline
  rule specifies `retrieval: browser`. Bot-block statuses (402/403/429/503)
  escalate to the stealth browser when `escalate: browser`.
- **Structured output** -- defuddle extraction produces a typed section tree.
  Callers can read a summary, one section, or write back into the document
  instead of dumping the whole page into context.

## Requirements

- Node.js 22+.
- Docker (Desktop or Engine) is needed only when pipeline rules specify
  `runtime: container` (the default for HTML). Markdown-only workflows run
  without Docker; `doctor` reports Docker as a warning when all effective
  rules are local.

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

> The local image embeds CloakBrowser and is for your machine only -- the
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

Four tools, all snake_case.

### `fetch_file`

Fetches a URI into the artefact store (local HTTP, `file://`, or container
dispatch for browser rules). Returns the file Digest (id, hash, mime, size).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `uri` | string | -- | URL or local path to fetch. |
| `chunk_mode` | enum | `none` | `none` or `standard` (section-based for markdown, byte-range for binary). |

Non-HTML responses (PDFs, images, JSON, ...) are downloaded and their Digest
returned; no conversion is attempted. SWR freshness: fresh entries return from
cache without network; stale entries serve from cache and revalidate in the
background.

### `read_document`

Serves a document Digest from the store. Converts the source file to a section
tree on first read (markdown in-process, HTML via defuddle + linkedom).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `resource` | string | -- | URI or 22-char artefact id. File ids hop to the converted document. |
| `read_mode` | enum | `all` | `all` (metadata + section tree), `meta_only`, `sections_only`. |

Responses omit all file URIs. `source_changed: true` when the source file has
been re-fetched but the document was locally edited (never auto-overwritten).

### `read_section`

Serves one or more sections by id with content blocks attached.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `artefact_id` | string | -- | The 22-char artefact id. |
| `section_id` | string or string[] | -- | Section id(s) to serve. |
| `children_mode` | enum | `include` | `include` (recursive subtree) or `exclude`. |

Oversized sections (>50 KB) set `truncated: true` and list `child_ids` as the
next step. Unknown ids return an error listing all valid section ids.

### `write_section`

Replaces a section subtree with hash-based optimistic locking.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `artefact_id` | string | -- | The 22-char artefact id. |
| `section` | object | -- | Section tree with id, title, content, children, hash. |
| `children_mode` | enum | `replace` | `replace` only in v1 (absent children are deleted with subtrees). |

The root section id must exist. Descendants with known ids carry their hash
for lock validation; any hash mismatch rejects the entire write. Front-matter
sections are YAML-validated before splice.

## Settings engine

Per-MIME pipeline rules configured in `digest.settings.json` (zod-validated).
A generated JSON schema (`digest-settings.schema.json`) ships with the
package for editor validation.

Each rule selects:
- `retrieval`: `http` (plain fetch) or `browser` (stealth Chromium)
- `parser`: `defuddle` (HTML-to-markdown), `passthrough` (copy), `raw` (bytes)
- `runtime`: `local` (in-process) or `container` (Docker)
- `escalate`: `browser` (bot-block escalation) or `none`

Resolution: exact MIME > type wildcard (`type/*`) > `*/*`. `browser` retrieval
structurally requires `container` runtime (validated at load time).

Loader precedence (first hit wins):
1. `DIGEST_CONFIG` env var (explicit path)
2. `<cwd>/digest.settings.json` (dev/test mode only)
3. `$XDG_CONFIG_HOME/digest/settings.json` or `~/.config/digest/settings.json`
4. Built-in defaults (`text/html` to browser+defuddle+container; `*/*` to
   http+raw+container)

## Configuration

Set via the MCP server's `env` block (or `install --artefact-root <path>` /
`install --repo <path>`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DIGEST_ARTEFACT_ROOT` | `~/.claude/digest` | Base dir with `artefact/` (store) and `logs/`. Each session may set its own. |
| `DIGEST_REPO_ROOT` | -- | If set, dev mode: server re-execs from source under `tsx --watch`. Point at the `app/digest` dir of a clone. |
| `DIGEST_CONFIG` | -- | Explicit path to a `digest.settings.json`, overrides all other settings sources. |

Different sessions can point at different artefact roots safely -- the shared
container is root-agnostic and the host writes into the configured root.

## How it works

```
Claude Code --stdio--> digest MCP server (host, Node)     [one per session]
  tools: fetch_file / read_document / read_section / write_section
  settings engine (per-MIME pipeline rules), artefact store, SWR cache
  ensureContainer (only when a rule needs runtime: container)
                        | HTTP (localhost:<ephemeral port>)
                        v
  shared container (image digest:local, FROM cloakhq/cloakbrowser)
  cloakserve (CDP :9222) + fetch/convert service:
    instruction protocol {retrieval, parser, escalate} -->
    pre-flight --> render via connectOverCDP --> defuddle --> RETURNS content
```

The MCP server auto-starts the shared container on first use when a fetch rule
needs `runtime: container`. Missing Docker is a hard error only for those
rules; local-only pipelines (markdown, plain downloads) work without Docker.
`doctor` reports Docker as a warning when all effective rules are local.

### Artefact store

Under `DIGEST_ARTEFACT_ROOT` (default `~/.claude/digest`):

```
artefact/
  {artefact-id}/            one dir per origin URI + type
    digest.json             the Digest record (file + document branches)
    <filename>              raw fetched file (original name preserved)
    chunks/                 chunk files (when chunk_mode is 'standard')
  artefact-index.json       corpus index with web-cache fields (ETag, fresh_until)
logs/
  docs/{artefact-id}/       per-document JSONL pipeline event log
  digest-server.log         host server log
  cloakbrowser.log          container log follower (docker logs -f)
```

Artefact ids are deterministic: `base64url(sha256(origin_uri + ':' + type))[0..22]`.
Section ids are random 22-char base64url GUIDs, sticky across re-parses via a
3-pass rematch algorithm (exact title, sibling index, block hash).

### Dev mode

Set `DIGEST_REPO_ROOT` to the `app/digest` directory of a clone, and the
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
`app/digest` is the published MCP server (`@mfassaie/digest`), built on
`@digest/shared` (settings, artefact store, markdown engine, fetch, SWR,
chunking, HTML adapter), `@digest/mcp-server` (tool definitions) and
`@digest/docker` (container lifecycle, in-image service, instruction
protocol). `packages/e2e` holds the end-to-end tests, and
`packages/tooling-evals` is the converter eval harness.

## Licence

[MIT](LICENSE) for this project's code. The CloakBrowser base image is
proprietary (free to use, no redistribution); the derived image is built
locally and never published.
