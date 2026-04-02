import type { CliArgs } from './types.js';

export function parseArgs(
  argv: string[],
): CliArgs | null {
  const sub = argv[2];
  if (sub !== 'install' && sub !== 'uninstall') {
    return null;
  }

  let scope: 'project' | 'global' = 'project';
  const scopeIdx = argv.indexOf('--scope');
  if (scopeIdx !== -1 && argv[scopeIdx + 1]) {
    const val = argv[scopeIdx + 1];
    if (val === 'global' || val === 'project') {
      scope = val;
    }
  }

  return { subcommand: sub, scope };
}

export function printUsage(): void {
  const msg = `Usage: webfetch-plus [command]

Commands:
  install [--scope project|global]    Register MCP server
  uninstall [--scope project|global]  Remove MCP server

Options:
  --help       Show this help message
  --version    Show version number

With no command, starts the MCP server on stdio.`;
  console.error(msg);
}

export function printVersion(): void {
  const pkg = process.env.npm_package_version ?? '0.1.0';
  console.log(pkg);
}
