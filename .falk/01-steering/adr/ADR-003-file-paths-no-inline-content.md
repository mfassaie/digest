# ADR-003: File paths only, no inline content

## Status

Accepted

## Context

The built-in WebFetch returns content inline in the tool response. This
means the entire page content (or Haiku summary) lands in the agent's
context window regardless of whether the agent needs all of it.

Since webfetch-plus already saves content to disk (ADR-002), the tool
can return file paths instead. The caller uses Read to access only what
it needs. This also unifies the handling of all content types: HTML,
text, JSON, and binary files all return metadata + paths.

## Decision

The tool response contains only metadata (URL, status, content-type,
title, file sizes, timestamps) and file paths. Content is never
returned inline. The caller reads files via the Read tool.

## Consequences

- Smaller tool responses (metadata only, ~200 tokens vs potentially
  thousands)
- Agent reads only what it needs from disk
- Binary files (PDF, images) handled the same way as text
- Extra Read call required to access content (one additional tool call)
- Callers accustomed to inline content must adapt (but Read is always
  available to Claude Code agents)
