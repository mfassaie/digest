# Feature: Deployment

## Scope

### Boundaries

**In scope:**
- `.mcp.json` at project root registering webfetch-plus as a stdio MCP server
- PreToolUse hook in `.claude/settings.json` blocking built-in WebFetch
- Path-based command pointing to dist/index.js
- Hook denial reason directing agents to the MCP tool

**Out of scope:**
- npx-based installation (deferred until package is published)
- Global (~/.claude.json) registration
- Automated install script
- MCP Inspector smoke test automation

**Anti-goals:**
- Not modifying any global Claude Code config
- Not using permissions.deny (broken, #11812)

### Constraints

| Constraint | Detail |
|-----------|--------|
| Platform | Windows (native, not WSL). Path separators matter. |
| Bug avoidance | Cannot use permissions.deny for WebFetch (#11812) |
| Scope | Project-scoped only (.mcp.json + .claude/settings.json) |

### Dependencies

| Dependency | Type | Risk |
|-----------|------|------|
| Built dist/index.js | Prerequisite | Low. Already built and verified. |
| Claude Code hooks support | Runtime | Low. Documented, stable feature. |
| .mcp.json project scope | Runtime | Low. Documented mechanism. |

### Feasibility

Trivial. Two JSON files with known, documented structure.

### ADRs

- ADR-004: PreToolUse hook to block built-in WebFetch

## Define

### Behaviour

#### SPEC-007: MCP server registration via .mcp.json

```gherkin
Given a project with .mcp.json pointing to webfetch-plus
When Claude Code opens the project
Then the webfetch_plus tool is available to agents
And the tool is listed as mcp__webfetch_plus__webfetch_plus
```

**Business rules:**
- .mcp.json lives at project root
- command: "node", args: absolute path to dist/index.js
- Server name: "webfetch-plus"

#### SPEC-008: Built-in WebFetch blocked by hook

```gherkin
Given a project with the PreToolUse hook configured
When an agent attempts to call WebFetch
Then the call is denied with permissionDecision: "deny"
And the denial reason names the MCP tool to use instead
And the agent self-corrects to use mcp__webfetch_plus__webfetch_plus
```

**Business rules:**
- Hook matcher: "WebFetch"
- Hook returns JSON with permissionDecision: "deny"
- Denial reason includes the MCP tool name
- Hook must not break plugin loading

### Interface

#### API-005: .mcp.json schema

```json
{
  "mcpServers": {
    "webfetch-plus": {
      "command": "node",
      "args": ["<absolute-path>/dist/index.js"]
    }
  }
}
```

#### API-006: PreToolUse hook schema

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebFetch",
        "hooks": [
          {
            "type": "command",
            "command": "<echo command returning deny JSON>"
          }
        ]
      }
    ]
  }
}
```

### Domain

No new domain entities. This is configuration only.

### Technical Design

#### Files to create

| File | Purpose |
|------|---------|
| `.mcp.json` | Project-scoped MCP server registration |
| `.claude/settings.json` | PreToolUse hook to block built-in WebFetch (merge with existing) |

#### .claude/settings.json merge strategy

The project already has a `.claude/settings.json` with plugin config.
The hook must be merged into the existing file, not overwrite it.

### Quality

#### NFR-004: Hook must not break plugin loading

The PreToolUse hook for WebFetch must coexist with existing plugin
configuration. Verify that plugins still load after adding the hook.

### Traceability

| ID | Source | Test type | Description |
|----|--------|-----------|-------------|
| SPEC-007 | Discovery decision 1 | Manual | MCP server registration |
| SPEC-008 | Discovery decision 2 | Manual | WebFetch blocked by hook |
| API-005 | Discovery research | Manual | .mcp.json schema |
| API-006 | Discovery research | Manual | Hook schema |
| NFR-004 | Discovery (#11812) | Manual | Hook does not break plugins |

Note: all tests are manual (smoke test) since these are JSON config
files verified by Claude Code's runtime, not our test suite.

## Review

Gate Verdict: PASS

| Check | Result | Notes |
|-------|--------|-------|
| Completeness | Pass | All sections present. Domain justified N/A. |
| Testability | Pass | All IDs have manual test approach. Automated testing not applicable for config files. |
| Consistency | Pass | Hook approach matches discovery decision. No permissions.deny. |
| Traceability | Pass | All 5 IDs linked to discovery source. |

Three-perspective review:
- User: agents get redirected to MCP tool automatically, no manual intervention
- Developer: two JSON files, merge with existing settings, no code changes
- Business: zero-config deployment per project, version-controlled

Specification locked. Ready for implementation.
