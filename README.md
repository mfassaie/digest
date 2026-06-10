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
| [`packages/fetch-service`](packages/fetch-service) | `@digest/fetch-service` — the in-image fetch/convert service, bundled into the image. |
| [`packages/e2e`](packages/e2e) | `@digest/e2e` — end-to-end tests driving the built host handlers against a live `digest:local` container. |
| [`packages/tooling-evals`](packages/tooling-evals) | `@digest/tooling-evals` — the HTML-to-Markdown converter eval harness (defuddle chosen, ADR-006). |

```sh
pnpm install
pnpm build        # build the host package
pnpm test         # host tests
pnpm --filter @digest/fetch-service test   # fetch-service tests
```

Key design decisions are noted in code comments by ADR number (converter
choice, container engine, read tool, host-side writing).

## Licence

[MIT](LICENSE).
