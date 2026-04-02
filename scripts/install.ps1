#Requires -Version 5.1
<#
.SYNOPSIS
  Install webfetch-plus MCP server into a target project.
  Creates .mcp.json, adds a PreToolUse hook, and sets deny/allow rules.

.PARAMETER Target
  Path to the target project directory. Defaults to current directory.

.EXAMPLE
  .\scripts\install.ps1
  .\scripts\install.ps1 -Target C:\Projects\my-app
#>
param(
  [string]$Target = "."
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebfetchDir = Split-Path -Parent $ScriptDir
$EntryPoint = Join-Path $WebfetchDir "dist\index.js"

if (-not (Test-Path $EntryPoint)) {
  Write-Error "dist/index.js not found. Run 'pnpm build' first."
}

$Target = Resolve-Path $Target
if (-not (Test-Path $Target -PathType Container)) {
  Write-Error "$Target is not a directory."
}

Write-Host "Installing webfetch-plus into $Target"

# Forward slashes for JSON compatibility
$EntryJson = $EntryPoint.ToString().Replace("\", "/")

# --- 1. Create or merge .mcp.json ---

$McpFile = Join-Path $Target ".mcp.json"
if (Test-Path $McpFile) {
  $cfg = Get-Content $McpFile -Raw | ConvertFrom-Json
} else {
  $cfg = [pscustomobject]@{}
}

if (-not $cfg.mcpServers) {
  $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})
}
$cfg.mcpServers | Add-Member -NotePropertyName "webfetch-plus" -Force -NotePropertyValue ([pscustomobject]@{
  command = "node"
  args = @("--use-system-ca", $EntryJson)
})
$cfg | ConvertTo-Json -Depth 10 | Set-Content $McpFile -Encoding UTF8
Write-Host "  .mcp.json: $(if (Test-Path $McpFile) { 'merged' } else { 'created' }) webfetch-plus server"

# --- 2. Create or merge .claude/settings.json with PreToolUse hook ---

$ClaudeDir = Join-Path $Target ".claude"
if (-not (Test-Path $ClaudeDir)) { New-Item -ItemType Directory -Path $ClaudeDir | Out-Null }

$SettingsFile = Join-Path $ClaudeDir "settings.json"
if (Test-Path $SettingsFile) {
  $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
} else {
  $settings = [pscustomobject]@{}
}

$DenyReason = "Use mcp__webfetch_plus__webfetch_plus instead. Built-in WebFetch is disabled in this project."

# Build the hook echo payload as a JSON string
$hookPayload = @{
  hookSpecificOutput = @{
    hookEventName = "PreToolUse"
    permissionDecision = "deny"
    permissionDecisionReason = $DenyReason
  }
} | ConvertTo-Json -Depth 5 -Compress
$hookCommand = "echo $hookPayload"

$hook = [pscustomobject]@{
  matcher = "WebFetch"
  hooks = @([pscustomobject]@{
    type = "command"
    command = $hookCommand
  })
}

if (-not $settings.hooks) {
  $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
}
if (-not $settings.hooks.PreToolUse) {
  $settings.hooks | Add-Member -NotePropertyName PreToolUse -NotePropertyValue @()
}

$existing = $settings.hooks.PreToolUse | Where-Object { $_.matcher -eq "WebFetch" }
if (-not $existing) {
  $settings.hooks.PreToolUse = @($settings.hooks.PreToolUse) + @($hook)
}

$settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
Write-Host "  .claude/settings.json: $(if ($existing) { 'already has' } else { 'added' }) WebFetch hook"

# --- 3. Create or merge .claude/settings.local.json with deny + allow ---

$LocalSettings = Join-Path $ClaudeDir "settings.local.json"
if (Test-Path $LocalSettings) {
  $local = Get-Content $LocalSettings -Raw | ConvertFrom-Json
} else {
  $local = [pscustomobject]@{}
}

if (-not $local.permissions) {
  $local | Add-Member -NotePropertyName permissions -NotePropertyValue ([pscustomobject]@{})
}
if (-not $local.permissions.deny) {
  $local.permissions | Add-Member -NotePropertyName deny -NotePropertyValue @()
}
if (-not $local.permissions.allow) {
  $local.permissions | Add-Member -NotePropertyName allow -NotePropertyValue @()
}

if ("WebFetch" -notin $local.permissions.deny) {
  $local.permissions.deny = @($local.permissions.deny) + @("WebFetch")
}
$mcpTool = "mcp__webfetch-plus__webfetch_plus"
if ($mcpTool -notin $local.permissions.allow) {
  $local.permissions.allow = @($local.permissions.allow) + @($mcpTool)
}

$local | ConvertTo-Json -Depth 10 | Set-Content $LocalSettings -Encoding UTF8
Write-Host "  .claude/settings.local.json: deny/allow rules set"

Write-Host ""
Write-Host "Done. Restart Claude Code in $Target to activate."
