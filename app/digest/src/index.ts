#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { StdioServerTransport } from
  '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '@digest/mcp-server';
import { getRepoRoot, logLine } from '@digest/shared';
import { parseArgs, printUsage, printVersion } from
  './cli.js';
import {
  resolveProjectTarget,
  resolveGlobalTarget,
  isProjectRoot,
} from './cli-config.js';
import { install } from './cli-install.js';
import { uninstall } from './cli-uninstall.js';
import { setup } from './cli-setup.js';
import { doctor } from './cli-doctor.js';
import { defaultDeps } from './deps.js';
import { getVersion } from './version.js';

const sub = process.argv[2];

// Run the MCP server on stdio with the production wiring.
async function main(): Promise<void> {
  const deps = defaultDeps();
  const server = createServer(deps, getVersion());
  await server.connect(new StdioServerTransport());
  logLine(
    'info',
    `digest ${getVersion()} ready (artefacts ${deps.store.paths.root})`,
  );
}

// Dev mode: when DIGEST_REPO_ROOT is set, run the MCP server from the repo
// source under a watcher so code edits hot-reload. The child sets
// DIGEST_DEV_CHILD to avoid re-exec loops, and inherits stdio so the MCP
// stream flows through to the client.
function startServer(): void {
  const repo = getRepoRoot();
  if (repo && !process.env.DIGEST_DEV_CHILD) {
    console.error(`digest: dev mode, running from ${repo} under watch`);
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--watch', join(repo, 'src', 'index.ts')],
      {
        cwd: repo,
        stdio: 'inherit',
        env: { ...process.env, DIGEST_DEV_CHILD: '1' },
      },
    );
    child.on('error', (err) => {
      console.error('digest dev mode failed to start:', err.message);
      process.exit(1);
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }
  main().catch((err) => {
    console.error('digest failed to start:', err);
    process.exit(1);
  });
}

if (sub === '--help') {
  printUsage();
  process.exit(0);
} else if (sub === '--version') {
  printVersion();
  process.exit(0);
} else if (sub === 'setup') {
  setup().then((code) => process.exit(code));
} else if (sub === 'doctor') {
  doctor().then((code) => process.exit(code));
} else if (sub === 'install' || sub === 'uninstall') {
  const args = parseArgs(process.argv);
  if (!args || (args.subcommand !== 'install'
    && args.subcommand !== 'uninstall')) {
    printUsage();
    process.exit(1);
  }
  runCli(args.subcommand, args.scope, {
    artefactRoot: args.artefactRoot, repoRoot: args.repoRoot,
  }).catch((err) => {
    console.error(err instanceof Error
      ? err.message : String(err));
    process.exit(1);
  });
} else if (sub && !sub.startsWith('-')) {
  console.error(`Unknown command: ${sub}\n`);
  printUsage();
  process.exit(1);
} else {
  startServer();
}

async function runCli(
  subcommand: 'install' | 'uninstall',
  scope: 'project' | 'global',
  env: { artefactRoot?: string; repoRoot?: string } = {},
): Promise<void> {
  const target = scope === 'global'
    ? resolveGlobalTarget()
    : resolveProjectTarget(process.cwd());

  if (scope === 'project') {
    const valid = await isProjectRoot(process.cwd());
    if (!valid) {
      console.error(
        'Not a project root (no package.json or .git).\n' +
        'Use --scope global for user-wide install.',
      );
      process.exit(1);
    }
  }

  if (subcommand === 'install') {
    console.log(
      `Installing digest (${scope} scope)...`,
    );
    const log = await install(target, env);
    log.forEach(l => console.log(l));
    console.log(
      '\nDone. If you have not already, run `digest setup` to ' +
      'build the Docker image, then restart Claude Code to activate.',
    );
  } else {
    console.log(
      `Removing digest (${scope} scope)...`,
    );
    const log = await uninstall(target);
    log.forEach(l => console.log(l));
    console.log(
      '\nDone. Restart Claude Code to take effect.',
    );
  }
}
