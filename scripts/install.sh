#!/usr/bin/env bash
set -euo pipefail

# Install webfetch-plus MCP server into a target project.
# Creates .mcp.json and adds a PreToolUse hook to block built-in WebFetch.
#
# Usage: ./scripts/install.sh /path/to/target/project

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBFETCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY_POINT="$WEBFETCH_DIR/dist/index.js"

if [ ! -f "$ENTRY_POINT" ]; then
  echo "Error: dist/index.js not found. Run 'pnpm build' first."
  exit 1
fi

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"

if [ ! -d "$TARGET" ]; then
  echo "Error: $TARGET is not a directory."
  exit 1
fi

echo "Installing webfetch-plus into $TARGET"

# Forward slashes for JSON compatibility
ENTRY_JSON=$(echo "$ENTRY_POINT" | sed 's|\\|/|g')

# 1. Create or merge .mcp.json
MCP_FILE="$TARGET/.mcp.json"
if [ -f "$MCP_FILE" ]; then
  node -e "
    const cfg = JSON.parse(process.argv[1]);
    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers['webfetch-plus'] = {
      command: 'node',
      args: ['--use-system-ca', process.argv[2]]
    };
    process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
  " "$(cat "$MCP_FILE")" "$ENTRY_JSON" > "$MCP_FILE.tmp"
  mv "$MCP_FILE.tmp" "$MCP_FILE"
  echo "  .mcp.json: merged webfetch-plus server"
else
  cat > "$MCP_FILE" << MCPEOF
{
  "mcpServers": {
    "webfetch-plus": {
      "command": "node",
      "args": ["--use-system-ca", "$ENTRY_JSON"]
    }
  }
}
MCPEOF
  echo "  .mcp.json: created"
fi

# 2. Create or merge .claude/settings.json with PreToolUse hook
CLAUDE_DIR="$TARGET/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
mkdir -p "$CLAUDE_DIR"

DENY_REASON="Use mcp__webfetch_plus__webfetch_plus instead. Built-in WebFetch is disabled in this project."

# Build the hook command. The inner JSON must be escaped for the
# outer JSON, so we let Node handle all serialisation.
add_hook() {
  local existing="$1"
  node -e "
    const cfg = JSON.parse(process.argv[1]);
    const reason = process.argv[2];
    const hookCmd = 'echo ' + JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    });
    const hook = {
      matcher: 'WebFetch',
      hooks: [{ type: 'command', command: hookCmd }]
    };
    if (!cfg.hooks) cfg.hooks = {};
    if (!cfg.hooks.PreToolUse) cfg.hooks.PreToolUse = [];
    if (!cfg.hooks.PreToolUse.some(h => h.matcher === 'WebFetch')) {
      cfg.hooks.PreToolUse.push(hook);
    }
    process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
  " "$existing" "$DENY_REASON"
}

if [ -f "$SETTINGS_FILE" ]; then
  add_hook "$(cat "$SETTINGS_FILE")" > "$SETTINGS_FILE.tmp"
  mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
  echo "  .claude/settings.json: merged WebFetch hook"
else
  add_hook "{}" > "$SETTINGS_FILE"
  echo "  .claude/settings.json: created with WebFetch hook"
fi

# 3. Create or merge .claude/settings.local.json with deny + allow
LOCAL_SETTINGS="$CLAUDE_DIR/settings.local.json"

add_permissions() {
  local existing="$1"
  node -e "
    const cfg = JSON.parse(process.argv[1]);
    if (!cfg.permissions) cfg.permissions = {};
    if (!cfg.permissions.deny) cfg.permissions.deny = [];
    if (!cfg.permissions.deny.includes('WebFetch')) {
      cfg.permissions.deny.push('WebFetch');
    }
    if (!cfg.permissions.allow) cfg.permissions.allow = [];
    const mcpTool = 'mcp__webfetch-plus__webfetch_plus';
    if (!cfg.permissions.allow.includes(mcpTool)) {
      cfg.permissions.allow.push(mcpTool);
    }
    process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
  " "$existing"
}

if [ -f "$LOCAL_SETTINGS" ]; then
  add_permissions "$(cat "$LOCAL_SETTINGS")" > "$LOCAL_SETTINGS.tmp"
  mv "$LOCAL_SETTINGS.tmp" "$LOCAL_SETTINGS"
  echo "  .claude/settings.local.json: merged deny/allow rules"
else
  add_permissions "{}" > "$LOCAL_SETTINGS"
  echo "  .claude/settings.local.json: created with deny/allow rules"
fi

echo ""
echo "Done. Restart Claude Code in $TARGET to activate."
