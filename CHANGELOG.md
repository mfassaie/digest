# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 14-06-2026

Initial public release.

### Tools

Four MCP tools over stdio, all snake_case:

- **`fetch_file`** -- fetch a URI (HTTP, `file://`, or stealth browser) into
  the artefact store. SWR-fresh caching with ETag/If-Modified-Since
  revalidation. Optional `chunk_mode: standard` for section-based (markdown)
  or byte-range (binary) chunking.
- **`read_document`** -- serve a document Digest from the store. Converts the
  source file to a typed section tree on first read. Modes: `all`,
  `meta_only`, `sections_only`.
- **`read_section`** -- serve one or more sections by id with content blocks.
  Recursive children by default; oversized sections (>50 KB) are truncated
  with `child_ids` for drill-down.
- **`write_section`** -- replace a section subtree with hash-based optimistic
  locking. YAML front-matter validated before splice.

### Fetching

- Bounded host-side abort on every fetch (timeout + 10s), independent of the
  browser or container. The MCP server cannot hang.
- Stealth Chromium rendering (CloakBrowser in Docker) for JavaScript-rendered
  and bot-protected pages. Automatic escalation from plain HTTP to the stealth
  browser on 402/403/429/503.
- SWR freshness via `http-cache-semantics`: conditional revalidation, retries,
  `source_changed` divergence detection.
- Docker is conditional: needed only when pipeline rules specify
  `runtime: container`. Markdown and plain downloads run in-process.

### Content

- Typed section tree with sticky ids across re-parses (3-pass rematch:
  exact title, sibling index, block hash).
- Hash-based optimistic locking for writes; any hash mismatch rejects the
  entire write.
- Markdown engine (remark/mdast): fold headings, content-only hashes,
  byte-range splice, extractive summary/keywords.
- HTML adapter: defuddle + linkedom in-process for local rules; container
  dispatch with instruction protocol for browser rules.
- Chunking: section-based for markdown, fixed-size byte ranges for binary.

### Artefact store

- Deterministic 22-char artefact ids (`base64url(sha256(uri + ':' + type))`).
- Per-artefact `digest.json` record (file + document branches), raw file,
  optional chunk files.
- Corpus-wide `artefact-index.json` with web-cache fields (ETag,
  `fresh_until`).
- JSONL event log per document under `logs/docs/`.

### Settings engine

- Per-MIME pipeline rules in `digest.settings.json` (zod-validated):
  `retrieval` (http/browser), `parser` (defuddle/passthrough/raw),
  `runtime` (local/container), `escalate` (browser/none).
- Resolution: exact MIME > type wildcard (`type/*`) > `*/*`.
- Loader precedence: `DIGEST_CONFIG` env > cwd (dev mode) >
  `$XDG_CONFIG_HOME` > built-in defaults.
- Published JSON schema for editor validation.

### CLI

- `digest install [--scope project|global] [--artefact-root <path>]` --
  register the MCP server, block built-in WebFetch, set permissions.
- `digest uninstall` -- reverse `install`.
- `digest setup` -- build the local Docker image.
- `digest doctor` -- environment check: Docker, image, settings source,
  effective rule table, artefact root, logs.

### Infrastructure

- pnpm workspace monorepo: `app/digest` (published MCP server),
  `packages/shared`, `packages/mcp-server`, `packages/docker`,
  `packages/e2e`, `packages/tooling-evals`.
- esbuild bundles workspace packages; npm deps are external.
- CI, CodeQL, and manual-dispatch publish workflows.
- Dependabot for npm and GitHub Actions dependencies.
- npm provenance via `--provenance` flag.
