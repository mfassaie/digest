# Discovery: Public Release

Started: 2026-04-03
Status: complete
Activities: 5

## Problem Statement

webfetch-plus is a working MCP server with a verified MVP and deployment
config. It needs to be prepared for public release as an npm package
installable via `npx webfetch-plus`, with built-in CLI commands to
install/uninstall into global or project scope, and with all the
community/governance files expected of a public GitHub repo.

### Goals

1. Installable from npm: `npx webfetch-plus` runs the MCP server
2. Built-in install/uninstall CLI subcommands for project and global scope
3. GitHub repo meets public-facing best practices (README, LICENSE, CI/CD, etc.)
4. Discoverable via npm search, MCP Registry, and MCP directories

### Anti-goals

- Not publishing to a private registry
- Not building a website or documentation site
- Not supporting non-Claude MCP clients in the first release (though the
  install badges can point to them)

## Research Findings

### Repo audit -- 2026-04-03

**What exists and is correct:**
- package.json: name, version (0.1.0), type (module), description, bin, engines, license (MIT)
- Shebang `#!/usr/bin/env node` in dist/index.js
- .gitignore: comprehensive (covers .mcp.json, .claude/, dist/, node_modules/, coverage/)
- No hardcoded paths in source code (only in .mcp.json which is gitignored)
- No sensitive data (API keys, tokens, credentials)
- Install scripts exist: scripts/install.sh, scripts/install.ps1
- TypeScript declarations generated (.d.ts files in dist/)

**What is missing:**
- README.md
- LICENSE file (MIT declared in package.json but no file)
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- CHANGELOG.md
- SECURITY.md (exists in .falk/ but not in root or .github/)
- .github/ directory (no workflows, issue templates, PR template, dependabot)
- .editorconfig
- package.json fields: repository, homepage, bugs, author, keywords, files, exports
- No prepublishOnly script
- No chmod +x in build script (needed for Unix npx execution)

**Package size issue:** npm pack currently includes 61 files / 154KB
(source, .falk/, test files, config). With a `files` field set to
`["dist"]`, this drops to ~10-15KB.

### npm publishing -- 2026-04-03

**npx execution requirements (all met except chmod):**
- bin field maps command to dist/index.js (done)
- Shebang present (done)
- File permissions: tsc does not set +x on output. Need `shx chmod +x dist/*.js`
  or `node -e "require('fs').chmodSync('dist/index.js', '755')"` after tsc.
  Only matters on Unix (npm creates .cmd wrappers on Windows).

**package.json additions needed:**
- `files: ["dist"]` (allowlist, not .npmignore)
- `repository`, `author`, `keywords`, `homepage`, `bugs`
- `exports` (optional, for programmatic consumers)
- `prepublishOnly: "npm run build"` script

**ESM: no gotchas.** `"type": "module"` is set, imports use .js
extensions, moduleResolution is NodeNext. Node 22+ supports
`require(esm)` so CJS consumers can use the package too.

**Install/uninstall CLI pattern:**
The existing shell scripts (scripts/install.sh, scripts/install.ps1) should
be ported into the CLI binary as subcommands:

```
webfetch-plus                    # default: run MCP server (stdio)
webfetch-plus install            # install into current project (.mcp.json)
webfetch-plus install --global   # install into ~/.claude.json (user scope)
webfetch-plus uninstall          # remove from current project
webfetch-plus uninstall --global # remove from ~/.claude.json
```

This way `npx webfetch-plus install` works without shipping shell scripts.
The install logic must also add the PreToolUse hook to block built-in
WebFetch, which generic tools like `claude mcp add` or `add-mcp` cannot do.

**Versioning:** Stay at 0.1.0. Pre-1.0 signals "API may change". Move to
1.0.0 after real-world feedback stabilises the interface. This matches
what most MCP servers do (@playwright/mcp is at 0.0.70, fetcher-mcp at
0.3.9).

**npm trusted publishing (OIDC):** Eliminates npm tokens entirely. Configure
a trusted publisher on npmjs.com linking the GitHub repo. GitHub Actions
workflow gets `permissions: id-token: write`. Requires npm CLI >= 11.5.1
and Node >= 22.14.0 (both satisfied by engines >= 22).

### GitHub public repo -- 2026-04-03

**Required files:**

| File | Purpose |
|------|---------|
| README.md | Project overview, installation, usage, MCP config snippets |
| LICENSE | MIT licence full text |
| CHANGELOG.md | Keep a Changelog format, starting with [0.1.0] |
| SECURITY.md | Vulnerability reporting process, supported versions |
| CONTRIBUTING.md | Dev setup, code style, PR process |
| CODE_OF_CONDUCT.md | Contributor Covenant 3.0 |

**README sections for an MCP server npm package:**
1. Title + one-line description
2. Badges (npm version, CI, license, MCP install badges from mcpbadge.dev)
3. Problem statement (why this exists)
4. Features bullet list
5. Installation (`npx`, `npm install`, MCP config JSON for Claude Code/VS Code/Cursor)
6. Configuration (parameters, cache location)
7. Usage (what the tool returns, response format)
8. Development (clone, pnpm install, build, test, lint)
9. Contributing (link to CONTRIBUTING.md)
10. Licence

**CI/CD workflows:**

ci.yml (on push/PR to main):
- pnpm install --frozen-lockfile
- pnpm lint (tsc --noEmit)
- pnpm build
- pnpm test
- Optional: coverage upload to Codecov

publish.yml (on GitHub Release / tag v*):
- Build + test
- npm publish with trusted publishing (OIDC, no npm token)
- Provenance attestations generated automatically

**.github/ templates:**
- ISSUE_TEMPLATE/bug_report.yml (YAML form: description, steps, expected, actual, environment)
- ISSUE_TEMPLATE/feature_request.yml (problem, proposed solution, alternatives)
- ISSUE_TEMPLATE/config.yml (chooser linking to Discussions for questions)
- PULL_REQUEST_TEMPLATE.md (summary, issue link, change type, checklist)
- dependabot.yml (weekly npm + github-actions updates)

**MCP-specific discoverability:**
- MCP Registry: create server.json, publish via mcp-publisher (namespace: io.github.mfassaie/webfetch-plus)
- mcpbadge.dev: one-click install badges for VS Code, Cursor, Claude Code
- Directories: Smithery.ai, mcp.so, PulseMCP, awesome-mcp-servers (PR to add)

**GitHub repo settings:**
- Topics: mcp, mcp-server, model-context-protocol, webfetch, claude, claude-code, typescript, nodejs
- Rulesets on main: require PR, require CI pass, block force push
- Discussions: enable with Announcements, Q&A, Ideas categories

### npm name availability -- 2026-04-03

All four candidate names are available on npmjs.com:
- `webfetch-plus` (preferred, matches package.json)
- `@mfassaie/webfetch-plus`
- `mcp-webfetch-plus`
- `webfetch-mcp`

Decision: use `webfetch-plus` (unscoped).

### Install subcommand scope -- 2026-04-03

User decision: use `--scope global|project` flag.

```
webfetch-plus                          # default: run MCP server (stdio)
webfetch-plus install                  # default scope: project
webfetch-plus install --scope project  # explicit: write .mcp.json + .claude/settings.json in cwd
webfetch-plus install --scope global   # write to Claude Code's global config
webfetch-plus uninstall                # default scope: project
webfetch-plus uninstall --scope project
webfetch-plus uninstall --scope global
```

**Project scope** (`--scope project`, default):
- Write .mcp.json in cwd (create or merge)
- Add PreToolUse hook to .claude/settings.json in cwd (create or merge)
- Error if cwd does not look like a project root (no package.json, no .git, etc.)

**Global scope** (`--scope global`):
- Write to Claude Code's global MCP config location
- Add PreToolUse hook to global Claude Code settings
- Both use `npx webfetch-plus` as the command (not an absolute path)

**Uninstall** reverses the corresponding install:
- Remove the webfetch-plus entry from .mcp.json / global config
- Remove the PreToolUse WebFetch hook
- Do not delete other entries or settings

## Assumptions

| # | Assumption | Confidence | Evidence | Consequence if wrong |
|---|-----------|-----------|---------|---------------------|
| 1 | npm package name "webfetch-plus" is available | Medium | Not yet checked on npmjs.com | Must choose alternative name or use scoped package |
| 2 | GitHub repo will be at github.com/mfassaie/webfetch-plus | High | Git remote already configured | URLs in package.json and docs would need updating |
| 3 | Trusted publishing (OIDC) works for new npm accounts | High | npm docs confirm GA since July 2025 | Fall back to npm automation token |
| 4 | Users will primarily use this with Claude Code | High | Built-in WebFetch replacement is Claude Code specific | Install badges for other clients would be misleading |
| 5 | Porting shell scripts to TypeScript subcommands is feasible | High | Simple JSON read/write/merge operations | Keep shell scripts as fallback |

## Gap Analysis

### Blocking gaps

None. Both resolved:
1. ~~npm name availability~~ -- "webfetch-plus" is available (verified 2026-04-03)
2. ~~Install subcommand scope~~ -- user decision: `--scope global|project` flag (see research above)

### Non-blocking gaps

3. **MCP Registry publishing** -- server.json schema and mcp-publisher workflow can be added post-release
4. **mcpbadge.dev integration** -- deeplink format for Claude Code not yet confirmed
5. **Contributor Covenant version** -- 3.0 is current but should verify exact text
6. **Coverage badge source** -- Codecov vs shields.io vs local badge generation
7. **Whether to enable GitHub Discussions** -- small project, might just use issues
8. **Claude Code global config location** -- need to confirm exact path for `--scope global` during implementation

## Summary

The repo is functionally complete but has none of the public-facing files.
The work breaks into three areas:

1. **npm packaging** -- package.json fields, files whitelist, build script
   fix (chmod), prepublishOnly, and porting install/uninstall shell scripts
   into CLI subcommands
2. **GitHub community files** -- README, LICENSE, CHANGELOG, SECURITY,
   CONTRIBUTING, CODE_OF_CONDUCT, issue/PR templates
3. **CI/CD and automation** -- GitHub Actions for test/lint/build on PR,
   npm publish on release with trusted publishing, dependabot

The install subcommand work is the most significant code change. Everything
else is configuration and documentation.
