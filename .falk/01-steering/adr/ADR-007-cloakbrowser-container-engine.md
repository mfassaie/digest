# ADR-007: CloakBrowser-in-Docker fetch engine

- Status: Accepted
- Date: 2026-06-10

## Context

v1 fetched with Node `fetch()`: no JavaScript rendering and no stealth, so
SPA/hydrated pages returned empty shells and bot-protected pages failed. v2
needs real rendering. CloakBrowser (CloakHQ stealth Chromium) provides a
Playwright-compatible CDP endpoint and ships as a Docker image.

## Decision

Run download + HTML→Markdown conversion inside a derived Docker image
(`FROM cloakhq/cloakbrowser`), with the host MCP server orchestrating it.

- The container runs `cloakserve` (CDP multiplexer on :9222) plus a small
  Node HTTP service (`POST /fetch`, `GET /healthz`). The service drives the
  browser via `playwright-core` `connectOverCDP('http://127.0.0.1:9222')`,
  renders, converts with defuddle (ADR-006), and writes
  `raw`/`content.md`/`structure.json` to a `/data` volume.
- The host computes the cache path, bind-mounts the cache dir to `/data`,
  publishes the service to an ephemeral `127.0.0.1` port, and calls `/fetch`
  with a host-side abort at `timeout + 10s` — the MCP server can never hang
  even if the container does (the project's founding guarantee, now held on
  the host side independently of the engine).
- The MCP server auto-manages the container lifecycle (run/start/health).
  If Docker or the image is unavailable, it hard-errors with setup
  instructions; there is **no** fall back to plain fetch (deliberate — a
  silent non-rendering fallback would reintroduce the v1 failure mode
  invisibly).

## Licence constraint (important)

The CloakBrowser **binary** licence (proprietary, free to use) permits
internal/derived Docker images but **forbids redistribution**. Therefore:

- The derived image is **built locally** on the user's machine via
  `npx falk-document setup` and is **never pushed** to any registry —
  not Docker Hub, not GHCR, not in CI.
- The npm package ships only the build context (`docker/`: Dockerfile,
  launcher, service bundle, runtime deps manifest), not the image.
- CI may build the image for integration tests but must never push it.

The wrapper code we author is MIT; only the base binary is restricted.

## Consequences

- Users need Docker installed and ~600 MB for the local image. `setup`
  makes this an explicit, one-time, progress-reported step; the MCP runtime
  never builds (too slow mid-tool-call).
- Recon (ADR refs `.falk/02-discover/2026-06-10-cloakbrowser-recon.md`):
  the base already has Node 20 and an Xvfb-then-exec entrypoint, so the
  Dockerfile only adds the service and reuses both.
- Validated live: static HTML, a JS-rendered SPA (content impossible to get
  with v1 plain fetch), `raw_only`, and binary download, all writing to the
  mapped volume.
- amd64-only base image; Apple Silicon runs under emulation (documented).

## Known limitation: pre-flight bypasses stealth

The orchestrator does a pre-flight request (Playwright `APIRequestContext`)
to resolve redirects, validators (ETag/304) and content-type before
deciding whether to render. That request is a plain HTTP call — it does
**not** carry CloakBrowser's browser-level stealth (TLS/JS fingerprint).
Real-corpus testing (2026-06-10) found Stack Overflow returns **HTTP 402**
to it, so a bot-protected page can be rejected at pre-flight even though a
full stealth navigation might have succeeded.

Follow-up (not yet done): for the initial hop, navigate HTML with the
stealth browser (`page.goto`) and derive status/content-type/redirect from
the navigation response, reserving the plain request for conditional
revalidation of already-cached resources. Tracked as a task.
