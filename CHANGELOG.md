# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
