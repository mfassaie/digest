#!/usr/bin/env bash
set -euo pipefail

# Remove webfetch-plus MCP server from a target project.
# Removes the server from .mcp.json and the PreToolUse hook from .claude/settings.json.
#
# Usage: ./scripts/uninstall.sh /path/to/target/project

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"

if [ ! -d "$TARGET" ]; then
  echo "Error: $TARGET is not a directory."
  exit 1
fi

echo "Removing webfetch-plus from $TARGET"

# 1. Remove from .mcp.json
MCP_FILE="$TARGET/.mcp.json"
if [ -f "$MCP_FILE" ]; then
  node -e "
    const cfg = JSON.parse(process.argv[1]);
    if (cfg.mcpServers && cfg.mcpServers['webfetch-plus']) {
      delete cfg.mcpServers['webfetch-plus'];
      if (Object.keys(cfg.mcpServers).length === 0) delete cfg.mcpServers;
    }
    if (Object.keys(cfg).length === 0) {
      process.stdout.write('EMPTY');
    } else {
      process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
    }
  " "$(cat "$MCP_FILE")" > "$MCP_FILE.tmp"

  if [ "$(cat "$MCP_FILE.tmp")" = "EMPTY" ]; then
    rm "$MCP_FILE" "$MCP_FILE.tmp"
    echo "  .mcp.json: removed (was empty)"
  else
    mv "$MCP_FILE.tmp" "$MCP_FILE"
    echo "  .mcp.json: removed webfetch-plus server"
  fi
else
  echo "  .mcp.json: not found, skipping"
fi

# 2. Remove hook from .claude/settings.json
SETTINGS_FILE="$TARGET/.claude/settings.json"
if [ -f "$SETTINGS_FILE" ]; then
  node -e "
    const cfg = JSON.parse(process.argv[1]);
    if (cfg.hooks && cfg.hooks.PreToolUse) {
      cfg.hooks.PreToolUse = cfg.hooks.PreToolUse.filter(
        h => h.matcher !== 'WebFetch'
      );
      if (cfg.hooks.PreToolUse.length === 0) delete cfg.hooks.PreToolUse;
      if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
    }
    process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
  " "$(cat "$SETTINGS_FILE")" > "$SETTINGS_FILE.tmp"
  mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
  echo "  .claude/settings.json: removed WebFetch hook"
else
  echo "  .claude/settings.json: not found, skipping"
fi

# 3. Remove deny/allow from .claude/settings.local.json
LOCAL_SETTINGS="$TARGET/.claude/settings.local.json"
if [ -f "$LOCAL_SETTINGS" ]; then
  node -e "
    const cfg = JSON.parse(process.argv[1]);
    if (cfg.permissions) {
      if (cfg.permissions.deny) {
        cfg.permissions.deny = cfg.permissions.deny.filter(
          r => r !== 'WebFetch'
        );
        if (cfg.permissions.deny.length === 0) delete cfg.permissions.deny;
      }
      if (cfg.permissions.allow) {
        cfg.permissions.allow = cfg.permissions.allow.filter(
          r => r !== 'mcp__webfetch-plus__webfetch_plus'
        );
        if (cfg.permissions.allow.length === 0) delete cfg.permissions.allow;
      }
      if (Object.keys(cfg.permissions).length === 0) delete cfg.permissions;
    }
    process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
  " "$(cat "$LOCAL_SETTINGS")" > "$LOCAL_SETTINGS.tmp"
  mv "$LOCAL_SETTINGS.tmp" "$LOCAL_SETTINGS"
  echo "  .claude/settings.local.json: removed deny/allow rules"
else
  echo "  .claude/settings.local.json: not found, skipping"
fi

echo ""
echo "Done. Restart Claude Code in $TARGET to take effect."
