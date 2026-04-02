# Feature: Public Release

## Scope

### Boundaries

**In scope:**
- package.json metadata fields (repository, author, keywords, homepage, bugs, files, exports)
- Build script fix (chmod +x for Unix npx compatibility)
- prepublishOnly script
- CLI dual-mode entry point: detect subcommands before starting MCP server
- `install` subcommand: register MCP server + PreToolUse hook + deny/allow rules
- `uninstall` subcommand: reverse install
- `--scope project` (default): writes .mcp.json, .claude/settings.json, .claude/settings.local.json in cwd
- `--scope global`: writes to Claude Code's global/user-level config locations
- README.md
- LICENSE file (MIT full text)
- CHANGELOG.md (Keep a Changelog format, [0.1.0] entry)
- SECURITY.md (vulnerability reporting)
- Remove old shell scripts (scripts/*.sh, scripts/*.ps1)

**Out of scope:**
- CONTRIBUTING.md, CODE_OF_CONDUCT.md (deferred)
- .github/ directory (issue templates, PR template, CI/CD workflows, dependabot)
- MCP Registry listing (server.json, mcp-publisher)
- mcpbadge.dev install badges
- Directory listings (Smithery.ai, mcp.so, awesome-mcp-servers)
- GitHub repo settings (topics, rulesets, Discussions)
- npm account setup / first publish (manual)

**Anti-goals:**
- Not adding a CLI framework dependency (commander, yargs)
- Not supporting non-Claude MCP clients in install subcommand
- Not building a documentation site

### Constraints

| Constraint | Detail |
|-----------|--------|
| Platform | Cross-platform (Windows + Unix). Install subcommand uses Node built-ins only (fs, path, os). |
| No new runtime deps | CLI arg parsing via process.argv. JSON merge via Node fs. |
| Backwards compatible | `npx webfetch-plus` (no args) must still start the MCP server. |
| Package size | Published tarball contains dist/ only (plus auto-included package.json, README, LICENSE). |

### Dependencies

| Dependency | Type | Risk |
|-----------|------|------|
| Existing MCP server code | Must not break | Low. Entry point routing is additive. |
| node -e chmod one-liner | Build script | Low. No new dependency. No-op on Windows. |
| Claude Code config paths | Runtime | Medium. Global config location (~/.claude.json vs ~/.claude/settings.json) must be confirmed during implementation. |

### Feasibility

No show-stoppers. The install/uninstall logic already exists in shell scripts and
just needs porting to TypeScript. The JSON merge operations are straightforward
with Node built-ins. Community files are standard boilerplate.

### ADRs

- ADR-005: Dual-mode entry point (MCP server + CLI subcommands)

## Define

### Behaviour

#### SPEC-009: Dual-mode entry point routing

```gherkin
Given the binary is invoked with no arguments
When the process starts
Then the MCP server starts on stdio transport
And no CLI output is printed to stdout
```

```gherkin
Given the binary is invoked with "install" as the first argument
When the process starts
Then the install logic runs instead of the MCP server
And progress messages are printed to stdout
```

```gherkin
Given the binary is invoked with "uninstall" as the first argument
When the process starts
Then the uninstall logic runs instead of the MCP server
```

```gherkin
Given the binary is invoked with an unknown subcommand
When the process starts
Then a usage message is printed to stderr
And the process exits with code 1
```

```gherkin
Given the binary is invoked with "--help" or "--version"
When the process starts
Then the appropriate info is printed to stdout
And the process exits with code 0
```

**Business rules:**
- Routing is based on process.argv[2]
- Subcommand must be the first argument after the binary name. Flags before the subcommand (e.g. `webfetch-plus --scope global install`) are not supported and will trigger the usage error.
- Recognised subcommands: "install", "uninstall"
- Recognised flags (without subcommand): "--help" (print usage, exit 0), "--version" (print version from package.json, exit 0)
- No args: start MCP server (backwards compatible)
- Unknown subcommand: print usage message to stderr, exit 1

#### SPEC-010: Install to project scope

```gherkin
Given a directory with a package.json or .git directory
When "webfetch-plus install" is run in that directory
Then .mcp.json is created or merged with a webfetch-plus server entry
And .claude/settings.json is created or merged with a PreToolUse hook blocking WebFetch
And .claude/settings.local.json is created or merged with deny WebFetch + allow MCP tool
And a success message is printed listing what was written
```

```gherkin
Given .mcp.json already exists with other MCP servers
When install runs with --scope project
Then the webfetch-plus entry is added without removing existing entries
```

**Business rules:**
- Default scope is "project" when --scope is omitted
- .mcp.json entry: command "npx", args ["-y", "webfetch-plus"], env {"NODE_OPTIONS": "--use-system-ca"} (preserves TLS proxy compatibility)
- PreToolUse hook denies WebFetch with reason directing to mcp__webfetch-plus__webfetch_plus (hyphenated server name, matching .mcp.json key)
- Hook command uses `node -e` instead of `echo` for cross-platform reliability
- JSON files are pretty-printed with 2-space indent
- Existing entries for other tools are preserved during merge
- If webfetch-plus is already installed, overwrite its entry (idempotent). This includes migrating from older shell-script installs that used `node` with an absolute path.
- Both project and global scope can be installed simultaneously. Project-level config takes precedence in Claude Code when both exist.

#### SPEC-011: Install to global scope

```gherkin
Given the --scope global flag is provided
When "webfetch-plus install --scope global" is run
Then Claude Code's user-level MCP config is created or merged
And Claude Code's user-level settings are created or merged with the PreToolUse hook
And Claude Code's user-level local settings are created or merged with deny/allow rules
And a success message is printed listing what was written
```

**Business rules:**
- Global MCP config location: ~/.claude.json (mcpServers key)
- Global settings: ~/.claude/settings.json
- Global local settings: ~/.claude/settings.local.json
- MCP server command: "npx", args ["-y", "webfetch-plus"], env {"NODE_OPTIONS": "--use-system-ca"}
- Same hook and permissions structure as project scope
- Home directory resolved via os.homedir()
- Global config location is a known risk (Claude Code may change it). Implementation should verify the path exists or create it.

#### SPEC-012: Uninstall from project scope

```gherkin
Given webfetch-plus was previously installed in the project
When "webfetch-plus uninstall" is run in that directory
Then the webfetch-plus entry is removed from .mcp.json
And the WebFetch PreToolUse hook is removed from .claude/settings.json
And WebFetch deny and MCP tool allow are removed from .claude/settings.local.json
And other entries in those files are preserved
```

```gherkin
Given .mcp.json becomes empty after removing webfetch-plus
When uninstall completes
Then .mcp.json is deleted entirely
```

**Business rules:**
- Removes only webfetch-plus entries, preserves everything else
- Matches on the "webfetch-plus" key in mcpServers, not on command/args content (handles migration from old shell-script installs)
- Empty parent objects (mcpServers, hooks, permissions) are cleaned up
- If .mcp.json would be empty ({} or just {}), delete the file
- If .claude/settings.json or .claude/settings.local.json would be empty, delete the file
- If .claude/ directory is empty after cleanup, delete it
- If config files do not exist, skip silently (no error)

#### SPEC-013: Uninstall from global scope

```gherkin
Given webfetch-plus was previously installed globally
When "webfetch-plus uninstall --scope global" is run
Then the webfetch-plus entry is removed from ~/.claude.json
And the WebFetch hook is removed from ~/.claude/settings.json
And deny/allow rules are removed from ~/.claude/settings.local.json
```

**Business rules:**
- Same removal logic as project scope, targeting global file locations
- Same cleanup of empty parent objects

#### SPEC-014: Install validates project root

```gherkin
Given a directory with no package.json and no .git directory
When "webfetch-plus install" is run (project scope)
Then an error message is printed: "Not a project root"
And the process exits with code 1
And no files are created or modified
```

**Business rules:**
- Project root detection: cwd must contain package.json OR .git directory
- This check only applies to --scope project, not --scope global
- The error message should suggest using --scope global for user-wide install

#### SPEC-015: npm package metadata and files

```gherkin
Given the package is built and packed
When npm pack is run
Then the tarball contains only dist/ files plus package.json, README.md, and LICENSE
And no source files, test files, .falk/, or scripts/ are included
```

**Business rules:**
- package.json "files" field set to ["dist"]
- npm always includes package.json, README.md, LICENSE automatically
- prepublishOnly script runs build before publish
- Build script sets chmod +x on dist/index.js via `node -e` one-liner (no shx dependency)
- Acceptance: `npm pack --dry-run` must show only dist/ files plus package.json, README.md, LICENSE

#### SPEC-016: README content

```gherkin
Given the README.md file exists
When a user reads it
Then they can install webfetch-plus with a single npx command
And they understand what problem it solves
And they see the MCP config JSON to paste into their project
```

**Business rules:**
- README must include at minimum: title, one-line description, problem statement,
  features list, installation (npx one-liner + MCP config JSON), configuration
  (parameters, cache location), usage (response format), development setup, licence
- Installation section shows `npx webfetch-plus install` as the happy path
- MCP config JSON snippet for manual setup included as alternative

### Interface

#### API-007: CLI subcommand interface

```
webfetch-plus                              # start MCP server (default)
webfetch-plus install [--scope <scope>]    # install to project (default) or global
webfetch-plus uninstall [--scope <scope>]  # uninstall from project (default) or global
```

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| subcommand | string | no | (none = MCP server) | "install" or "uninstall" |
| --scope | string | no | "project" | "project" or "global" |

Exit codes:
- 0: success
- 1: error (unknown subcommand, not a project root, file I/O error)

#### API-008: .mcp.json entry format (project and global install)

```json
{
  "mcpServers": {
    "webfetch-plus": {
      "command": "npx",
      "args": ["-y", "webfetch-plus"],
      "env": {
        "NODE_OPTIONS": "--use-system-ca"
      }
    }
  }
}
```

For global scope, the same structure is merged into ~/.claude.json.

#### API-009: PreToolUse hook format

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebFetch",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Use mcp__webfetch-plus__webfetch_plus instead. Built-in WebFetch is disabled.'}}))\""
          }
        ]
      }
    ]
  }
}
```

Uses `node -e` instead of `echo` for cross-platform reliability (echo
behaves differently on Windows cmd.exe vs Unix shells).

#### API-010: Deny/allow permissions format

```json
{
  "permissions": {
    "deny": ["WebFetch"],
    "allow": ["mcp__webfetch-plus__webfetch_plus"]
  }
}
```

Note: the MCP tool name uses a hyphen (`webfetch-plus`) matching the
.mcp.json server key. Claude Code derives the tool name from this key.
```

### Domain

#### Entities

| Entity | Description |
|--------|------------|
| CliArgs | Parsed subcommand and scope from process.argv |
| ConfigTarget | Resolved file paths for a given scope (project or global) |
| JsonConfig | In-memory representation of a JSON config file being merged |

#### Invariants

| ID | Invariant | Test type |
|----|-----------|-----------|
| INV-009 | No args starts MCP server (backwards compatible) | Unit |
| INV-010 | Install merges with existing config, never overwrites the full file | Unit |
| INV-011 | Uninstall removes only webfetch-plus entries, preserves all others | Unit |
| INV-012 | Install is idempotent (running twice produces same result) | Unit |
| INV-013 | Hook command uses node -e (cross-platform), never echo | Unit |

### Technical Design

#### Components

```
src/
  index.ts              # Entry point: route to server or CLI
  server.ts             # MCP server (unchanged)
  cli.ts                # CLI subcommand dispatcher
  cli-install.ts        # Install logic (create/merge JSON configs)
  cli-uninstall.ts      # Uninstall logic (remove entries from JSON configs)
  cli-config.ts         # Config file path resolution (project vs global)
  cli-json.ts           # JSON file read/write/merge utilities
  fetcher.ts            # (unchanged)
  converter.ts          # (unchanged)
  cache.ts              # (unchanged)
  response.ts           # (unchanged)
  types.ts              # (unchanged, plus CLI types)
```

#### Data flow (install)

```
process.argv
  |
  v
Parse: subcommand = "install", scope = "project"|"global"
  |
  v
Resolve config paths (ConfigTarget)
  |-- project: cwd/.mcp.json, cwd/.claude/settings.json, cwd/.claude/settings.local.json
  |-- global: ~/.claude.json, ~/.claude/settings.json, ~/.claude/settings.local.json
  |
  v
For each config file:
  1. Read existing JSON (or empty {})
  2. Merge webfetch-plus entries
  3. Write back with 2-space indent
  |
  v
Print summary of changes
```

#### Data flow (uninstall)

```
process.argv
  |
  v
Parse: subcommand = "uninstall", scope = "project"|"global"
  |
  v
Resolve config paths (ConfigTarget)
  |
  v
For each config file:
  1. Read existing JSON (skip if file missing)
  2. Remove webfetch-plus entries
  3. Clean up empty parent objects
  4. Write back (or delete if file would be empty)
  |
  v
Print summary of changes
```

#### Entry point change

index.ts changes from:

```typescript
import { main } from './server.js';
main().catch(err => { ... });
```

To:

```typescript
const subcommand = process.argv[2];
if (subcommand === 'install' || subcommand === 'uninstall') {
  // dispatch to CLI
} else if (subcommand && subcommand !== '--') {
  // unknown subcommand: print usage, exit 1
} else {
  // start MCP server (current behaviour)
}
```

### Quality

#### NFR-005: No new runtime dependencies

The CLI subcommands use only Node built-ins (fs, path, os).
No commander, yargs, or other CLI framework added to dependencies.
Test: verify package.json dependencies are unchanged after implementation.

#### NFR-006: Install/uninstall completes in under 500ms

JSON read/merge/write for three small files should be near-instant.
Test: time the install subcommand execution.

### Traceability

| ID | Source | Test type | Description |
|----|--------|-----------|-------------|
| SPEC-009 | ADR-005 | Acceptance | Dual-mode entry point routing |
| SPEC-010 | Discovery install scope | Acceptance | Install to project scope |
| SPEC-011 | Discovery install scope | Acceptance | Install to global scope |
| SPEC-012 | Discovery install scope | Acceptance | Uninstall from project scope |
| SPEC-013 | Discovery install scope | Acceptance | Uninstall from global scope |
| SPEC-014 | Discovery install scope | Acceptance | Install validates project root |
| SPEC-015 | Discovery repo audit | Acceptance | npm package metadata and files |
| SPEC-016 | Discovery GitHub research | Manual | README content |
| API-007 | Discovery install scope | Contract | CLI subcommand interface |
| API-008 | Discovery install scope | Contract | MCP server entry format |
| API-009 | ADR-004 | Contract | PreToolUse hook format |
| API-010 | Discovery install scope | Contract | Deny/allow permissions format |
| INV-009 | ADR-005 | Unit | No args starts MCP server |
| INV-010 | Discovery install scope | Unit | Install merges, never overwrites |
| INV-011 | Discovery install scope | Unit | Uninstall preserves other entries |
| INV-012 | Discovery install scope | Unit | Install is idempotent |
| INV-013 | User review #1 | Unit | Hook uses node -e, not echo |
| NFR-005 | Scope constraint | Manual | No new runtime dependencies |
| NFR-006 | Scope constraint | Performance | Install completes in <500ms |

## Review

Gate Verdict: PASS

| Check | Result | Notes |
|-------|--------|-------|
| Completeness | Pass | All sections present. 8 specs, 4 APIs, 5 invariants, 2 NFRs. SPEC-016 (README) justified as manual test. |
| Testability | Pass | Every ID has automatable test type assigned (except SPEC-016 and NFR-005: manual). |
| Consistency | Pass | After fixes: hook uses node -e (cross-platform), tool name uses hyphen consistently, --use-system-ca preserved in env. |
| Traceability | Pass | All 19 IDs linked to discovery or review source and test type. |

### User perspective findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Blocking | echo hook fails on Windows | Fixed: API-009 now uses `node -e` instead of echo. INV-013 added. |
| 2 | Major | No dual-scope guidance | Fixed: SPEC-010 rules now state both scopes can coexist, project takes precedence. |
| 3 | Major | Uninstall leaves orphan .claude/ dir | Fixed: SPEC-012 rules now delete empty files and .claude/ directory. |
| 4 | Major | SPEC-009 contradicts itself | Fixed: removed contradictory business rule, kept error-on-unknown-subcommand. |
| 5 | Minor | --scope flag position | Fixed: business rule states subcommand must be first argument. |
| 6 | Minor | No --help / --version | Fixed: SPEC-009 now includes --help and --version handling. |
| 7 | Info | Migration from shell-script installs | Noted in SPEC-010 and SPEC-012 business rules. |

### Developer perspective findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Major | SPEC-009 contradiction | Fixed (same as user #4). |
| 2 | Major | --use-system-ca dropped | Fixed: API-008 now includes env.NODE_OPTIONS. |
| 3 | Minor | echo not cross-platform | Fixed (same as user #1). |
| 4 | Minor | INV-012 vacuous | Fixed: renumbered. Old forward-slash invariant removed, replaced with idempotency (INV-012) and node -e (INV-013). |
| 5 | Minor | shx vs node one-liner | Fixed: committed to node one-liner in SPEC-015 and dependencies table. |
| 6 | Info | Acceptance test runner strategy | Left to implementer (execFile in Vitest is straightforward). |
| 7 | Info | Global config location risk | Acknowledged in SPEC-011 business rules and dependencies table. |

### Business perspective findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Major | README content unspecified | Fixed: SPEC-016 added with required sections and happy-path install. |
| 2 | Major | --use-system-ca dropped | Fixed (same as dev #2). |
| 3 | Major | Config schema change risk | Acknowledged in SPEC-011. Mitigation deferred to implementation (version note in README). |
| 4 | Minor | No CI badge | Accepted: CI/CD deferred by scope decision. README should not include placeholder badge. |
| 5 | Minor | npm pack --dry-run not in criteria | Fixed: added to SPEC-015 acceptance criteria. |
| 6 | Minor | Tool name inconsistency | Fixed: all references now use hyphenated form consistently. |
| 7 | Info | Deferred items reasonable | Confirmed. |

### Conflicts

None. All three perspectives agreed on the echo/Windows issue and --use-system-ca gap.
Business and developer perspectives independently flagged the same missing items.

Specification locked. Ready for Plan.
