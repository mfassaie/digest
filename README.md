# digest

A monorepo for **digest**, an MCP server that fetches web pages through a
real headless browser (CloakBrowser, in Docker) and serves them back as
structured Markdown — a summary, the section outline, one named section,
keywords, or the full document. It replaces Claude Code's built-in WebFetch
with a timeout-safe, JavaScript-rendering alternative.

See **[packages/digest/README.md](packages/digest/README.md)** for
installation, configuration, tools, and usage.

## Layout

This is a pnpm workspace:

| Package | Purpose |
|---------|---------|
| [`packages/digest`](packages/digest) | `@mfassaie/digest` — the host MCP server (published) and the Docker build context. |
| [`packages/container`](packages/container) | `@digest/container` — the in-image fetch/convert service, bundled into the image. |
| [`packages/eval`](packages/eval) | `@digest/eval` — the HTML-to-Markdown converter eval harness (defuddle chosen, ADR-006). |

```sh
pnpm install
pnpm build        # build the host package
pnpm test         # host tests
pnpm --filter @digest/container test   # container tests
```

The design rationale lives in `.falk/01-steering/adr` (ADR-006 converter,
ADR-007 container engine, ADR-008 read tool, ADR-009 host-side writing).

## Licence

[MIT](LICENSE).
