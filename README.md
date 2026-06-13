# digest

[![npm version](https://img.shields.io/npm/v/@mfassaie/digest)](https://www.npmjs.com/package/@mfassaie/digest)
[![npm downloads](https://img.shields.io/npm/dm/@mfassaie/digest)](https://www.npmjs.com/package/@mfassaie/digest)
[![CI](https://github.com/mfassaie/digest/actions/workflows/ci.yml/badge.svg)](https://github.com/mfassaie/digest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP Server](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![Node 22+](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org)

> **Fetch, structure, and serve web content for your AI agent without hanging or losing context.**

digest is an MCP server that fetches files into a structured artefact store,
converts supported formats (markdown, HTML) to a typed section tree with sticky
ids and hash-based locking, and serves content through four tools. HTML pages
render in a stealth headless browser (CloakBrowser, in Docker) when the pipeline
rule requires it; markdown and plain downloads run entirely in-process.

Works with:

- Claude Code
- Claude Desktop
- any MCP client that speaks stdio

## Why digest

Claude Code's built-in WebFetch has no timeout and does not run JavaScript:
SPA/hydrated pages come back empty, bot-protected pages fail, and a fetch
that never returns hangs the agent. digest fixes all three:

- **No hang.** Every fetch is bounded by a host-side abort; the MCP server cannot hang even if the browser does.
- **Real rendering.** HTML pages load in stealth Chromium when the pipeline rule specifies `retrieval: browser`. Bot-block statuses (402/403/429/503) escalate to the stealth browser when `escalate: browser`.
- **Structured output.** Defuddle extraction produces a typed section tree. Callers can read a summary, one section, or write back into the document instead of dumping the whole page into context.

## What you get

| Fetching | Content | Configuration |
|----------|---------|---------------|
| SWR-fresh caching with ETag/Last-Modified revalidation, stealth Chromium for bot-blocked pages, bounded timeouts on every fetch, automatic escalation from plain HTTP to browser | Typed section tree with sticky ids across re-parses, hash-based optimistic locking for writes, YAML front-matter validation, chunking for large documents | Per-MIME pipeline rules (retrieval, parser, runtime, escalate), JSON schema for editor validation, env-var overrides, `doctor` for environment checks |

## Quickstart

```sh
npx @mfassaie/digest install     # register the MCP server + block built-in WebFetch
npx @mfassaie/digest setup       # build the local Docker image (~600 MB, one-time)
```

Then restart Claude Code. Check your environment any time:

```sh
npx @mfassaie/digest doctor
```

`install` registers the server in `.mcp.json`, adds a PreToolUse hook that
blocks the built-in WebFetch, and sets deny/allow permissions. Use
`--scope global` to apply to all projects, and `uninstall` to reverse it.

Once installed globally (`npm i -g @mfassaie/digest`) the commands shorten to
`digest install`, `digest setup`, and `digest doctor`.

Docker is needed only when pipeline rules specify `runtime: container` (the
default for HTML). Markdown-only workflows run without Docker.

> The local image embeds CloakBrowser and is for your machine only. The
> CloakBrowser binary licence forbids redistribution, so `setup` builds it
> locally and never pushes it anywhere.

## MCP Client Configuration

### Claude Code / Claude Desktop

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

Fetch a URI into the artefact store. Returns the file Digest (id, hash, mime,
size). Supports local HTTP, `file://`, and container dispatch for browser rules.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `uri` | string | -- | URL or local path to fetch. |
| `chunk_mode` | enum | `none` | `none` or `standard` (section-based for markdown, byte-range for binary). |

Non-HTML responses (PDFs, images, JSON, ...) are downloaded and their Digest
returned; no conversion is attempted. SWR freshness: fresh entries return from
cache without network; stale entries serve from cache and revalidate in the
background.

### `read_document`

Serve a document Digest from the store. Converts the source file to a section
tree on first read (markdown in-process, HTML via defuddle + linkedom).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `resource` | string | -- | URI or 22-char artefact id. File ids hop to the converted document. |
| `read_mode` | enum | `all` | `all` (metadata + section tree), `meta_only`, `sections_only`. |

Responses omit all file URIs. `source_changed: true` when the source file has
been re-fetched but the document was locally edited (never auto-overwritten).

### `read_section`

Serve one or more sections by id with content blocks attached.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `artefact_id` | string | -- | The 22-char artefact id. |
| `section_id` | string or string[] | -- | Section id(s) to serve. |
| `children_mode` | enum | `include` | `include` (recursive subtree) or `exclude`. |

Oversized sections (>50 KB) set `truncated: true` and list `child_ids` as the
next step. Unknown ids return an error listing all valid section ids.

### `write_section`

Replace a section subtree with hash-based optimistic locking.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `artefact_id` | string | -- | The 22-char artefact id. |
| `section` | object | -- | Section tree with id, title, content, children, hash. |
| `children_mode` | enum | `replace` | `replace` only in v1 (absent children are deleted with subtrees). |

The root section id must exist. Descendants with known ids carry their hash
for lock validation; any hash mismatch rejects the entire write. Front-matter
sections are YAML-validated before splice.

## Settings Engine

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

Different sessions can point at different artefact roots safely. The shared
container is root-agnostic and the host writes into the configured root.

## Architecture at a Glance

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

## Repo Guide

pnpm workspace monorepo (`app/*` + `packages/*`):

| Package | Purpose |
|---------|---------|
| [`app/digest`](app/digest) | `@mfassaie/digest` -- published MCP server + admin CLI (setup, doctor, install). Docker build context shipped via `files:["dist"]`. |
| [`packages/shared`](packages/shared) | `@digest/shared` -- settings engine, artefact store, markdown engine (fold/splice/sticky ids), fetch, SWR freshness, chunking, HTML adapter, logging. |
| [`packages/mcp-server`](packages/mcp-server) | `@digest/mcp-server` -- tool definitions (one module per tool), dispatch handlers, response formatting. |
| [`packages/docker`](packages/docker) | `@digest/docker` -- container lifecycle + HTTP client, in-image fetch/convert service, instruction protocol, image build context. |
| [`packages/e2e`](packages/e2e) | `@digest/e2e` -- end-to-end tests. No-Docker subset: `verify-dev`, `verify-store`, `verify-settings`. Docker-dependent: `e2e`, `verify-docroot`. |
| [`packages/tooling-evals`](packages/tooling-evals) | `@digest/tooling-evals` -- HTML-to-Markdown converter eval harness. |

Key design decisions are noted in code comments by ADR number.

## Common Commands

| Command | Purpose |
|---------|---------|
| `pnpm install && pnpm build` | set up the workspace |
| `pnpm test` | all package tests + no-Docker e2e |
| `pnpm lint` | `tsc --noEmit` across all packages |
| `digest doctor` | environment check (Docker, image, settings, artefact root) |
| `digest setup` | build the local Docker image |
| `digest install` | register the MCP server in `.mcp.json` |
| `digest uninstall` | reverse `install` |

## Documentation Map

| If you want to... | Start here |
|-------------------|------------|
| Install and start using digest | [Quickstart](#quickstart) |
| Configure your MCP client | [MCP Client Configuration](#mcp-client-configuration) |
| Understand the tool surface | [Tools](#tools) |
| Customise per-MIME pipeline rules | [Settings Engine](#settings-engine) |
| Set artefact root or dev mode | [Configuration](#configuration) |
| Understand the system shape | [Architecture at a Glance](#architecture-at-a-glance) |
| Contribute code or report bugs | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Review release history | [CHANGELOG.md](docs/CHANGELOG.md) |
| Report a security issue | [SECURITY.md](.github/SECURITY.md) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE) for this project's code. The CloakBrowser base image is
proprietary (free to use, no redistribution); the derived image is built
locally and never published.
