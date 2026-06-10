# ADR-008: read returns inline content

- Status: Accepted
- Date: 2026-06-10
- Relates to: ADR-003 (file paths, no inline content)

## Context

ADR-003 established that the fetch tool returns metadata and file paths
only, never inline page content — to keep large pages out of the model
context and force deliberate reads. v2 splits the tool in two
(`fetch`, `read`), and the read tool's whole
purpose is to return content.

## Decision

Scope ADR-003 to the **get** tool, and allow the **read** tool to return
content inline.

- `fetch` keeps the ADR-003 contract: metadata, file paths, and
  a cheap heading outline only. Never the body.
- `read` returns content inline, but in bounded, deliberate
  units chosen by the caller:
  - `sections` (default): the heading outline, or one named section's text
  - `summary`: an extractive summary (plus defuddle's description)
  - `keywords`: top terms
  - `full`: the whole Markdown (explicit opt-in)

The split preserves ADR-003's intent — content does not enter context by
accident on a fetch — while making retrieval a separate, explicit, mostly
small-payload step. `full` is the one unbounded mode and requires the
caller to ask for it by name.

## Consequences

- A caller's normal loop is: `get` (cheap, see the outline) → `read` a
  summary or a specific section. Whole-document dumps are opt-in.
- The read engine is local/extractive (no LLM) and deterministic; an LLM
  engine can be slotted behind the `ReadEngine` interface later without
  changing the tool contract.
