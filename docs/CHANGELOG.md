# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 13-06-2026

Breaking release: the tool surface, artefact model, and repo structure are
redesigned (ADR-010, ADR-011). No backwards compatibility with 0.2.x tool
names or cache layout.

### Added

- **4-tool surface** replacing the former `fetch`/`read` pair (ADR-011):
  `fetch_file` (fetch + store), `read_document` (serve the document Digest),
  `read_section` (serve individual sections with content blocks),
  `write_section` (hash-locked optimistic section replacement).
- **Artefact store** under `{DIGEST_ARTEFACT_ROOT}/artefact/{id}/` with
  deterministic 22-char artefact ids, `digest.json` per artefact, and a
  corpus-wide `artefact-index.json`. JSONL event log per document.
- **Markdown engine** (remark/mdast): fold headings into a typed section tree
  with sticky ids, content-only hashes, byte-range splice for writes, and
  extractive summary/keywords.
- **Settings engine** with zod-validated `digest.settings.json`: per-MIME
  pipeline rules (`retrieval`, `parser`, `runtime`, `escalate`), chunking
  strategy, and fetch budget. Precedence: `DIGEST_CONFIG` env > cwd (dev
  mode) > `$XDG_CONFIG_HOME` > built-in defaults. Published JSON schema.
- **SWR freshness** via `http-cache-semantics`: conditional revalidation
  (ETag/If-Modified-Since), configurable retries, `source_changed`
  divergence detection between the stored file hash and the document's
  conversion snapshot.
- **Chunking** (chunk_mode `standard`): section-based for markdown,
  fixed-size byte ranges for binary. Per-MIME strategy in settings.
- **HTML adapter**: defuddle + linkedom running in-process for
  `runtime: local` rules. Container dispatch with an instruction protocol
  (`retrieval`/`parser`/`escalate`) for `runtime: container` rules.
- `doctor` now reports the settings source, effective per-MIME rule table,
  and downgrades Docker checks to warnings when no rule needs the container.
- E2E tests: `verify-store` (full fetch/read/write/read-section round-trip,
  no Docker), `verify-settings` (settings precedence, rule resolution,
  doctor output).

### Changed

- **Repo restructure** (ADR-010): `app/digest` (the published
  `@mfassaie/digest`), `packages/shared` (`@digest/shared`, all host-side
  document logic), `packages/mcp-server` (`@digest/mcp-server`, tool
  definitions and handlers), `packages/docker` (`@digest/docker`, container
  lifecycle, in-image service, build context), `packages/e2e`, and
  `packages/tooling-evals`. esbuild bundles workspace packages into the
  published app; npm deps are external.
- `DIGEST_DOCUMENT_ROOT` renamed to `DIGEST_ARTEFACT_ROOT`.
- New env var `DIGEST_CONFIG` for explicit settings file path.
- Container is document-root-agnostic: returns content over HTTP, the host
  writes files (ADR-009). Docker is required only when effective rules
  specify `runtime: container`.

### Removed

- Former `fetch`/`read` tool names, `structure.json`/`meta.json` cache
  layout, and `/data` bind-mount. All replaced by the artefact store and
  the 4-tool surface.

## [0.2.0] - 2026-06-10

Renamed from `webfetch-plus` to `digest`. This is a substantial
re-architecture: fetching now runs through a real headless browser in
Docker, and the single tool is replaced by a get/read pair.

### Added

- Headless-browser fetch engine: CloakBrowser (stealth Chromium) in a
  local Docker image, so JavaScript-rendered pages are captured (ADR-007).
- `fetch` — fetch via browser, convert HTML to Markdown, return
  metadata, file paths and a section outline (never inline body).
- `read` — read a cached document as `summary`, `sections`
  (or one named section), `keywords`, or `full` (ADR-008).
- Local extractive read engine (summary + keywords, no LLM) behind a
  pluggable interface.
- `structure.json` heading index per cached document; section addressing by
  slug or title.
- Document metadata in `meta.json` (title, description, author, published,
  word count, …) surfaced by defuddle.
- CLI `setup` (build the local image) and `doctor` (environment checks).
- Converter eval harness (`eval/`) that drove the converter choice;
  defuddle selected (ADR-006).
- Host-side abort at `timeout + 10s` on every container call — the no-hang
  guarantee, now independent of the engine.

### Changed

- Package renamed to `digest`; bin and MCP server renamed; permission
  rules are now `mcp__digest__fetch` / `..._read`.
- Version is read from package.json at runtime (fixes the stale `0.1.0`
  reported by `--version`).
- `install`/`uninstall` clean up both the old `webfetch-plus` and new
  `digest` configuration.

### Removed

- Direct `fetch()` path. Docker is now required; if it is unavailable the
  tool hard-errors with setup instructions rather than silently degrading.

## [0.1.6] - 2026-04-03

### Changed

- Re-enabled npm `--provenance` flag after the repository was made
  public. No functional changes.

## [0.1.5] - 2026-04-03

### Fixed

- Publish workflow: switched to NPM_TOKEN auth and temporarily removed
  the `--provenance` flag so publishing succeeds. No functional changes.

Versions 0.1.2 to 0.1.4 were version bumps from failed publish runs and
were never released to npm.

## [0.1.1] - 2026-04-03

### Fixed

- Publish workflow: added the `packageManager` field so pnpm setup
  works in CI. No functional changes.

## [0.1.0] - 2026-04-03

### Added

- MCP server exposing `webfetch_plus` tool via stdio transport
- Hard timeout on all fetches (default 30s) via AbortSignal.timeout
- HTML content extraction and markdown conversion via defuddle
- Content-type branching: HTML, text, JSON, XML, binary
- HTTP-to-HTTPS auto-upgrade
- Cross-host redirect detection (reported, not followed)
- Same-host redirect following (up to 5 hops)
- Disk-based cache at ~/.claude/webfetch-plus/cache/
- HTTP conditional request cache validation (ETag / If-Modified-Since)
- Tool returns metadata and file paths only, never inline content
- CLI install/uninstall subcommands with --scope project|global
- PreToolUse hook to block built-in WebFetch and redirect to MCP tool
