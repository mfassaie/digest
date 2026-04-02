# Discovery: Deployment

Started: 2026-04-03
Status: complete
Activities: 2

## Problem Statement

webfetch-plus is built and verified but not yet deployable. Two things
need to happen for a target project to use it: the MCP server must be
registered, and the built-in WebFetch must be blocked so agents use the
replacement.

**Constraint:** Adding WebFetch to permissions.deny in settings.json
breaks all plugin loading (anthropics/claude-code#11812). An alternative
blocking mechanism is required.

**Goal:** A project-scoped, version-controlled installation that "just
works" when Claude Code opens the project. No global config changes.

## Research Findings

### MCP server registration - 2026-04-03

Claude Code reads `.mcp.json` from the project root for project-scoped
MCP server configuration. This file is version-controlled and shared
with the team.

**Format:**
```json
{
  "mcpServers": {
    "webfetch-plus": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"]
    }
  }
}
```

**Two installation patterns:**

| Pattern | .mcp.json command | When to use |
|---------|------------------|-------------|
| Path-based | `"command": "node", "args": ["/path/to/dist/index.js"]` | Local dev, single machine |
| npx-based | `"command": "npx", "args": ["-y", "webfetch-plus"]` | Published package, team use |

Note: on native Windows (not WSL), npx may need a `cmd /c` wrapper.
Path-based avoids this.

**Scope precedence:** local > project > user. A project `.mcp.json`
takes effect without touching `~/.claude.json`.

Sources:
- https://code.claude.com/docs/en/mcp

### Blocking built-in WebFetch - 2026-04-03

**The permissions.deny approach is broken.**

anthropics/claude-code#11812: adding `WebFetch` or `WebFetch(**)` to
`permissions.deny` in settings.json causes all plugins to fail loading.
The entire plugin system breaks, not just WebFetch.

**Three alternatives evaluated:**

| Option | Mechanism | Reliable? | Side effects |
|--------|-----------|-----------|-------------|
| Do nothing | Built-in WebFetch description says "prefer MCP-provided web fetch tool if available" | Partial. Agents usually self-select but not guaranteed | None |
| PreToolUse hook | Hook with `permissionDecision: "deny"` blocks WebFetch calls, returns message directing agent to MCP tool | Yes | None. Hooks don't affect plugin loading |
| permissions.deny | `"deny": ["WebFetch"]` in settings.json | Yes, but breaks plugins | All plugins fail to load |

**Decision: PreToolUse hook.**

Hook configuration in `.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebFetch",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Use mcp__webfetch_plus__webfetch_plus instead. Built-in WebFetch is disabled in this project.\"}}'"
          }
        ]
      }
    ]
  }
}
```

The hook fires on every WebFetch call, returns `permissionDecision:
"deny"` with a reason pointing to the MCP tool. The agent reads the
denial reason and self-corrects.

Sources:
- https://code.claude.com/docs/en/hooks
- https://github.com/anthropics/claude-code/issues/11812

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Project-scoped .mcp.json for registration | Version-controlled, team-shared, no global config changes |
| 2 | PreToolUse hook to block built-in WebFetch | Only reliable option that does not break plugin loading |
| 3 | Path-based command for now (not npx) | Avoids Windows npx wrapper issue, simpler for local dev |

## Assumptions

| # | Assumption | Confidence | Evidence | Consequence if wrong |
|---|-----------|-----------|---------|---------------------|
| 1 | PreToolUse hooks reliably block WebFetch | High | Documented mechanism, permissionDecision: "deny" | Fall back to "do nothing" and rely on agent self-selection |
| 2 | .mcp.json is read at project scope without user confirmation | Medium | Documented but may require trust dialog on first use | User clicks "trust" once |
| 3 | anthropics/claude-code#11812 is still open | Medium | Bug reported 2025-11, no fix mentioned | If fixed, permissions.deny becomes viable again |

## Gap Analysis

No blocking gaps. Both mechanisms (MCP registration and WebFetch
blocking) have clear, documented approaches.

## Summary

To install webfetch-plus into a target project, two files are needed:

1. `.mcp.json` at project root - registers the MCP server (stdio,
   points to dist/index.js)
2. `.claude/settings.json` with a PreToolUse hook - blocks built-in
   WebFetch and directs agents to the MCP tool

Both files are project-scoped and version-controlled. No global config
changes required. The permissions.deny approach is broken
(#11812) so a PreToolUse hook is used instead.
