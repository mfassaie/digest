# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
