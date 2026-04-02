# Plan: Deployment

## Wave 0 - Setup (sequential)

### TASK-D0-001: Create .mcp.json
- **Size:** S
- **Spec IDs:** SPEC-007, API-005
- **Description:** Create .mcp.json at project root with webfetch-plus MCP server registration. Command: node, args: absolute path to dist/index.js.
- **Test type:** Manual (verify tool appears in Claude Code session)
- **Dependencies:** dist/index.js must exist (already built)

### TASK-D0-002: Add PreToolUse hook to .claude/settings.json
- **Size:** S
- **Spec IDs:** SPEC-008, API-006, NFR-004
- **Description:** Merge PreToolUse hook into existing .claude/settings.json. Hook matcher: WebFetch, returns permissionDecision: "deny" with reason directing to MCP tool. Must preserve existing plugin config.
- **Test type:** Manual (verify WebFetch is blocked, plugins still load)
- **Dependencies:** TASK-D0-001

## Coverage Matrix

| Spec ID  | Covering task(s) |
|----------|-----------------|
| SPEC-007 | TASK-D0-001     |
| SPEC-008 | TASK-D0-002     |
| API-005  | TASK-D0-001     |
| API-006  | TASK-D0-002     |
| NFR-004  | TASK-D0-002     |

All 5 spec IDs covered.

## Audit

### Gate Verdict
READY

### Audit Notes
- **Coverage:** All 5 spec IDs covered by 2 tasks
- **Dependencies:** No circular dependencies. TASK-D0-002 depends on D0-001 (sequential)
- **Scope:** Two config files only, no code changes, matches spec exactly
- **Architecture:** ADR-004 respected (PreToolUse hook, not permissions.deny)
- **Risk:** Low. JSON config files with documented schemas.

### Audit Date
2026-04-03

## Implementation Audit

### Gate Verdict
COMPLETE

### Audit Summary
- **Wave completeness:** All tasks complete (2/2)
- **Test suite:** 74 tests, 100% pass rate (regression confirmed)
- **Spec coverage:** All 5 spec IDs covered (manual verification pending)
- **Files created:** .mcp.json (new), .claude/settings.json (merged hook with existing config)
- **Deviations:** None

### Audit Date
2026-04-03
