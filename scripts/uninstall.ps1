#Requires -Version 5.1
<#
.SYNOPSIS
  Remove webfetch-plus MCP server from a target project.
  Removes server from .mcp.json, hook from settings.json, and rules from settings.local.json.

.PARAMETER Target
  Path to the target project directory. Defaults to current directory.

.EXAMPLE
  .\scripts\uninstall.ps1
  .\scripts\uninstall.ps1 -Target C:\Projects\my-app
#>
param(
  [string]$Target = "."
)

$ErrorActionPreference = "Stop"

$Target = Resolve-Path $Target
if (-not (Test-Path $Target -PathType Container)) {
  Write-Error "$Target is not a directory."
}

Write-Host "Removing webfetch-plus from $Target"

# --- 1. Remove from .mcp.json ---

$McpFile = Join-Path $Target ".mcp.json"
if (Test-Path $McpFile) {
  $cfg = Get-Content $McpFile -Raw | ConvertFrom-Json
  if ($cfg.mcpServers -and $cfg.mcpServers."webfetch-plus") {
    $cfg.mcpServers.PSObject.Properties.Remove("webfetch-plus")
    if (($cfg.mcpServers.PSObject.Properties | Measure-Object).Count -eq 0) {
      $cfg.PSObject.Properties.Remove("mcpServers")
    }
  }
  if (($cfg.PSObject.Properties | Measure-Object).Count -eq 0) {
    Remove-Item $McpFile
    Write-Host "  .mcp.json: removed (was empty)"
  } else {
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $McpFile -Encoding UTF8
    Write-Host "  .mcp.json: removed webfetch-plus server"
  }
} else {
  Write-Host "  .mcp.json: not found, skipping"
}

# --- 2. Remove hook from .claude/settings.json ---

$SettingsFile = Join-Path $Target ".claude\settings.json"
if (Test-Path $SettingsFile) {
  $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
  if ($settings.hooks -and $settings.hooks.PreToolUse) {
    $settings.hooks.PreToolUse = @($settings.hooks.PreToolUse | Where-Object { $_.matcher -ne "WebFetch" })
    if ($settings.hooks.PreToolUse.Count -eq 0) {
      $settings.hooks.PSObject.Properties.Remove("PreToolUse")
    }
    if (($settings.hooks.PSObject.Properties | Measure-Object).Count -eq 0) {
      $settings.PSObject.Properties.Remove("hooks")
    }
  }
  $settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
  Write-Host "  .claude/settings.json: removed WebFetch hook"
} else {
  Write-Host "  .claude/settings.json: not found, skipping"
}

# --- 3. Remove deny/allow from .claude/settings.local.json ---

$LocalSettings = Join-Path $Target ".claude\settings.local.json"
if (Test-Path $LocalSettings) {
  $local = Get-Content $LocalSettings -Raw | ConvertFrom-Json
  if ($local.permissions) {
    if ($local.permissions.deny) {
      $local.permissions.deny = @($local.permissions.deny | Where-Object { $_ -ne "WebFetch" })
      if ($local.permissions.deny.Count -eq 0) {
        $local.permissions.PSObject.Properties.Remove("deny")
      }
    }
    if ($local.permissions.allow) {
      $local.permissions.allow = @($local.permissions.allow | Where-Object { $_ -ne "mcp__webfetch-plus__webfetch_plus" })
      if ($local.permissions.allow.Count -eq 0) {
        $local.permissions.PSObject.Properties.Remove("allow")
      }
    }
    if (($local.permissions.PSObject.Properties | Measure-Object).Count -eq 0) {
      $local.PSObject.Properties.Remove("permissions")
    }
  }
  $local | ConvertTo-Json -Depth 10 | Set-Content $LocalSettings -Encoding UTF8
  Write-Host "  .claude/settings.local.json: removed deny/allow rules"
} else {
  Write-Host "  .claude/settings.local.json: not found, skipping"
}

Write-Host ""
Write-Host "Done. Restart Claude Code in $Target to take effect."
