# ADR-001: Skip Haiku summarisation

## Status

Accepted

## Context

The built-in WebFetch sends fetched content through a Haiku model to
summarise it before returning to the caller. This served two purposes:
reducing token consumption in the main model's context, and enforcing
copyright quote limits on untrusted domains.

Discovery analysis showed that summarisation adds latency (1-3s per
call), creates an API dependency, and wastes tokens when the caller
needs more detail than the summary provides, causing re-fetches.

With 1M context (Opus) and 200K (Sonnet), raw page markdown is not a
context pressure problem. Defuddle handles content cleaning
algorithmically (removing nav, ads, clutter), which was the other
function Haiku served.

## Decision

Skip Haiku summarisation for MVP. Return clean markdown extracted by
defuddle. The `prompt` parameter is accepted but unused.

## Consequences

- Simpler architecture, no Anthropic API dependency
- No latency from model calls
- Caller sees full page content, can extract what it needs
- No copyright quote limiting on untrusted domains (acceptable for
  local tool)
- Can be added later as an optional post-processing step
