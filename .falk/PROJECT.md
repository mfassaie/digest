# digest

## Description

An MCP server that fetches web pages through a headless stealth browser
(CloakBrowser in Docker), converts them to structured Markdown, and serves a
summary, sections, keywords or the full document. Replaces Claude Code's
built-in WebFetch with a timeout-safe, JavaScript-rendering alternative.
Formerly `webfetch-plus` (v0.1.x), then briefly `falk-document`.

## Project Type

CLI tool / MCP server (stdio transport) + Docker fetch engine

## Key Stakeholders

- Developer: mfassaie

## Project Structure

- `CLAUDE.md` — Project instructions and conventions
- `.falk/` — Falk steering documents, specifications, and plans
