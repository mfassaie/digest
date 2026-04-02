# ADR-004: PreToolUse hook to block built-in WebFetch

## Status

Accepted

## Context

webfetch-plus replaces the built-in WebFetch, but agents may still call
the built-in unless it is explicitly blocked. The standard approach
(permissions.deny in settings.json) breaks all plugin loading
(anthropics/claude-code#11812).

## Options Considered

1. **permissions.deny** - simple, but breaks all plugins
2. **Do nothing** - rely on built-in's self-selection hint ("prefer
   MCP-provided web fetch tool if available"). Unreliable.
3. **PreToolUse hook** - intercepts WebFetch calls, returns
   permissionDecision: "deny" with a reason directing agents to the
   MCP tool

## Decision

Use a PreToolUse hook in .claude/settings.json to block built-in
WebFetch. The hook returns a deny decision with the MCP tool name
in the reason text.

## Consequences

- Built-in WebFetch is reliably blocked per project
- Plugin loading is unaffected
- Agents see a clear message directing them to the replacement
- Hook config is project-scoped and version-controlled
- If #11812 is fixed, can switch to permissions.deny (simpler)
