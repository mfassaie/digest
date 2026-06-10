import type { CliArgs } from './types.js';
import { getVersion } from './version.js';

const SUBCOMMANDS = ['install', 'uninstall', 'setup', 'doctor'] as const;

export function parseArgs(
  argv: string[],
): CliArgs | null {
  const sub = argv[2];
  if (!(SUBCOMMANDS as readonly string[]).includes(sub)) {
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

  return { subcommand: sub as CliArgs['subcommand'], scope };
}

export function printUsage(): void {
  const msg = `Usage: digest [command]

Commands:
  setup                               Build the local Docker image
  doctor                              Check Docker, image and cache
  install [--scope project|global]    Register MCP server
  uninstall [--scope project|global]  Remove MCP server

Options:
  --help       Show this help message
  --version    Show version number

With no command, starts the MCP server on stdio.`;
  console.error(msg);
}

export function printVersion(): void {
  console.log(getVersion());
}
