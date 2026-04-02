# ADR-005: Dual-mode entry point (MCP server + CLI subcommands)

## Status

Accepted

## Context

The published npm package needs to serve two purposes:
1. Run as an MCP server via stdio (the default, used by `npx webfetch-plus` in .mcp.json)
2. Run as a CLI tool for install/uninstall (`npx webfetch-plus install`)

The current entry point (index.ts) unconditionally starts the MCP server.

## Decision

Detect subcommands from process.argv before starting the server.
If argv contains `install` or `uninstall`, run the CLI logic.
Otherwise, start the MCP server (current behaviour).

Parse args with process.argv directly. No CLI framework dependency.
Only two subcommands exist (`install`, `uninstall`) with one flag
(`--scope global|project`).

## Consequences

- index.ts gains a routing layer (check argv, dispatch to server or CLI)
- CLI logic lives in a separate module (cli.ts) to keep server code untouched
- No new runtime dependencies
- `npx webfetch-plus` with no args still starts the MCP server (backwards compatible)
