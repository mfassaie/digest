# Security

## Authentication

Not applicable. This is a local MCP server communicating via stdio.

## Secrets Management

No secrets required for MVP. Haiku summarisation (which would need
ANTHROPIC_API_KEY) is deferred. See ADR-001.

## Input Validation

- Validate at system boundaries only (incoming tool call parameters)
- URL: must be a valid URL, auto-upgrade HTTP to HTTPS
- timeout_seconds: must be a positive number within reasonable bounds
- prompt: string, optional

## Filesystem Safety

- Cache writes are confined to ~/.claude/webfetch-plus/cache/
- URL-derived paths use hashed directory names to prevent path traversal
- No user-controlled file paths in cache operations

## Dependencies

- Audit dependencies with `pnpm audit`
- Keep dependencies minimal to reduce attack surface
