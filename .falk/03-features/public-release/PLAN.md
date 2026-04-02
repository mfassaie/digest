# Plan: Public Release

## Wave 0 - Setup (sequential)

### TASK-W0-001: Package.json metadata and build script
- **Size:** S
- **Spec IDs:** SPEC-015 (partial)
- **Description:** Add repository, author, keywords, homepage, bugs, files, exports fields to package.json. Add prepublishOnly script. Fix build script to append chmod +x via node one-liner. No shx dependency.
- **Test type:** None (verified by SPEC-015 acceptance test)
- **Dependencies:** None

### TASK-W0-002: CLI module scaffolding
- **Size:** M
- **Spec IDs:** (supports all CLI specs)
- **Description:** Add CLI types to types.ts (CliArgs, ConfigTarget). Create cli-config.ts (resolveConfigTarget for project/global scope, isProjectRoot detection). Create cli-json.ts (readJsonFile, writeJsonFile, deleteIfEmpty utilities). Create cli.ts (arg parsing dispatcher).
- **Test type:** None (exercised by Wave 1 unit tests)
- **Dependencies:** TASK-W0-001

### TASK-W0-003: Community files and cleanup
- **Size:** S
- **Spec IDs:** SPEC-016 (partial)
- **Description:** Create LICENSE (MIT full text), CHANGELOG.md (Keep a Changelog, [0.1.0] entry), SECURITY.md (vulnerability reporting). Delete scripts/install.sh, scripts/uninstall.sh, scripts/install.ps1, scripts/uninstall.ps1. Delete scripts/ directory.
- **Test type:** None
- **Dependencies:** None

## Wave 1 - Unit tests / INV (parallel)

### TASK-W1-001: Entry point routing
- **Size:** M
- **Spec IDs:** INV-009
- **Description:** Implement dual-mode routing in index.ts. Test that: no args invokes MCP server main(), "install" dispatches to CLI, "uninstall" dispatches to CLI, unknown subcommand exits 1, "--help" prints usage and exits 0, "--version" prints version and exits 0.
- **Test type:** Unit
- **Dependencies:** TASK-W0-002

### TASK-W1-002: JSON merge and idempotency
- **Size:** M
- **Spec IDs:** INV-010, INV-012
- **Description:** Implement merge functions in cli-install.ts (addMcpServer, addPreToolUseHook, addPermissions). Test that: merging into existing config preserves other entries, merging twice produces same result (idempotent), empty file initialised correctly.
- **Test type:** Unit
- **Dependencies:** TASK-W0-002

### TASK-W1-003: JSON removal and cleanup
- **Size:** M
- **Spec IDs:** INV-011
- **Description:** Implement removal functions in cli-uninstall.ts (removeMcpServer, removePreToolUseHook, removePermissions). Test that: removal preserves other mcpServers/hooks/permissions entries, empty parent objects are cleaned up, missing entries are handled gracefully.
- **Test type:** Unit
- **Dependencies:** TASK-W0-002

### TASK-W1-004: Hook content generation
- **Size:** S
- **Spec IDs:** INV-013
- **Description:** Implement hook content builder (generates the PreToolUse hook entry with node -e command). Test that: generated command uses "node -e", not "echo", JSON payload is valid, denial reason references correct MCP tool name (hyphenated).
- **Test type:** Unit
- **Dependencies:** TASK-W0-002

## Wave 2 - Contract tests / API (parallel)

### TASK-W2-001: CLI argument parsing contract
- **Size:** S
- **Spec IDs:** API-007
- **Description:** Test cli.ts parseArgs function: "install" -> {subcommand: "install", scope: "project"}, "install --scope global" -> {subcommand: "install", scope: "global"}, "uninstall" -> {subcommand: "uninstall", scope: "project"}, no args -> null, unknown -> error.
- **Test type:** Contract
- **Dependencies:** TASK-W1-001

### TASK-W2-002: MCP server entry and hook format
- **Size:** M
- **Spec IDs:** API-008, API-009
- **Description:** Test that addMcpServer generates exact JSON structure from API-008 (command: npx, args: ["-y", "webfetch-plus"], env: {NODE_OPTIONS: "--use-system-ca"}). Test that addPreToolUseHook generates exact JSON structure from API-009 (node -e command with correct payload).
- **Test type:** Contract
- **Dependencies:** TASK-W1-002, TASK-W1-004

### TASK-W2-003: Permissions format
- **Size:** S
- **Spec IDs:** API-010
- **Description:** Test that addPermissions generates exact JSON structure from API-010 (deny: ["WebFetch"], allow: ["mcp__webfetch-plus__webfetch_plus"]).
- **Test type:** Contract
- **Dependencies:** TASK-W1-002

## Wave 3 - Acceptance tests / SPEC (parallel)

### TASK-W3-001: Dual-mode entry point end-to-end
- **Size:** M
- **Spec IDs:** SPEC-009
- **Description:** Spawn the binary via execFile in Vitest. Test: no args connects MCP transport (verify process stays alive briefly then kill), "install" in a temp dir creates files, unknown subcommand prints usage to stderr and exits 1, "--help" exits 0, "--version" prints version.
- **Test type:** Acceptance
- **Dependencies:** All Wave 1 + Wave 2

### TASK-W3-002: Install to project scope + validation
- **Size:** L
- **Spec IDs:** SPEC-010, SPEC-014
- **Description:** Wire install flow: cli.ts dispatches to cli-install.ts, resolves project config paths, creates/merges all three files. Test full flow in temp directory with package.json: verify .mcp.json, .claude/settings.json, .claude/settings.local.json created with correct content. Test SPEC-014: no package.json or .git -> error exit.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-001

### TASK-W3-003: Install to global scope
- **Size:** M
- **Spec IDs:** SPEC-011
- **Description:** Test full install flow with --scope global. Mock os.homedir() to point to a temp directory. Verify ~/.claude.json, ~/.claude/settings.json, ~/.claude/settings.local.json created with correct content.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-001

### TASK-W3-004: Uninstall both scopes
- **Size:** L
- **Spec IDs:** SPEC-012, SPEC-013
- **Description:** Wire uninstall flow: cli.ts dispatches to cli-uninstall.ts, resolves config paths, removes entries. Test project scope: install then uninstall, verify files cleaned up, .claude/ directory removed when empty. Test global scope: install then uninstall with mocked homedir. Test: .mcp.json deleted when empty, other entries preserved.
- **Test type:** Acceptance
- **Dependencies:** TASK-W3-002, TASK-W3-003

### TASK-W3-005: npm package metadata and README
- **Size:** M
- **Spec IDs:** SPEC-015, SPEC-016
- **Description:** Create README.md with all required sections (title, description, problem, features, installation, configuration, usage, development, licence). Run npm pack --dry-run and verify tarball contains only dist/ plus auto-included files. No source, tests, .falk/, or scripts/ included.
- **Test type:** Acceptance (pack) + Manual (README review)
- **Dependencies:** TASK-W0-001, TASK-W0-003

## Wave 4 - NFR (parallel)

### TASK-W4-001: No new runtime dependencies
- **Size:** S
- **Spec IDs:** NFR-005
- **Description:** Verify package.json dependencies object contains only the original four runtime dependencies (@modelcontextprotocol/sdk, defuddle, linkedom, zod). No commander, yargs, or CLI framework added.
- **Test type:** Manual (automated assertion in test)
- **Dependencies:** TASK-W3-002

### TASK-W4-002: Install performance
- **Size:** S
- **Spec IDs:** NFR-006
- **Description:** Time the install subcommand in a temp directory. Assert completes in under 500ms.
- **Test type:** Performance
- **Dependencies:** TASK-W3-002

## Coverage Matrix

| Spec ID  | Covering task(s) |
|----------|-----------------|
| SPEC-009 | TASK-W3-001     |
| SPEC-010 | TASK-W3-002     |
| SPEC-011 | TASK-W3-003     |
| SPEC-012 | TASK-W3-004     |
| SPEC-013 | TASK-W3-004     |
| SPEC-014 | TASK-W3-002     |
| SPEC-015 | TASK-W3-005     |
| SPEC-016 | TASK-W3-005     |
| API-007  | TASK-W2-001     |
| API-008  | TASK-W2-002     |
| API-009  | TASK-W2-002     |
| API-010  | TASK-W2-003     |
| INV-009  | TASK-W1-001     |
| INV-010  | TASK-W1-002     |
| INV-011  | TASK-W1-003     |
| INV-012  | TASK-W1-002     |
| INV-013  | TASK-W1-004     |
| NFR-005  | TASK-W4-001     |
| NFR-006  | TASK-W4-002     |

All 19 spec IDs covered. No gaps.

## Audit

### Gate Verdict
READY

### Audit Notes
- **Coverage:** All 19 spec IDs covered, no gaps
- **Dependencies:** No circular dependencies, wave ordering correct (0->1->2->3->4)
- **Scope:** Tasks match spec boundaries, no scope creep, no deferred items included
- **Architecture:** ADR-005 respected (process.argv routing, no CLI framework, backwards compatible)
- **Risk:** Global config path uncertainty documented and mitigated. Wave 3 acceptance tests require `pnpm build` before execution (noted for implementation).
- **Codebase:** All new modules are additive. Existing 7 source files and 7 test files untouched. scripts/ directory correctly targeted for deletion.

### Audit Date
2026-04-03

## Implementation Audit

### Gate Verdict
COMPLETE

### Audit Summary
- **Wave completeness:** All waves (0-4) complete, 17 tasks implemented
- **Test suite:** 154 tests, 100% pass rate, 1.9s
- **Spec coverage:** All 19 spec IDs covered by passing tests
- **Code coverage:** 84% line, 75% branch, 85% function (new CLI modules all 100%; index.ts 0% is expected as process entry point tested via e2e child process; types.ts 0% is interface-only)
- **Build:** TypeScript compiles cleanly, no type errors
- **Deviations:** Wave 2 contract tests merged into Wave 1 unit tests (contracts already verified by exact output assertions in addMcpServer/addPreToolUseHook/addPermissions/buildHookCommand tests). cli-uninstall.ts bug fixed during W3-004 (uninstall was creating-then-deleting files instead of skipping missing ones).

### Audit Date
2026-04-03
