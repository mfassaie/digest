#!/usr/bin/env node
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
import { main } from './server.js';

const sub = process.argv[2];

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
  runCli(args.subcommand, args.scope).catch((err) => {
    console.error(err instanceof Error
      ? err.message : String(err));
    process.exit(1);
  });
} else if (sub && !sub.startsWith('-')) {
  console.error(`Unknown command: ${sub}\n`);
  printUsage();
  process.exit(1);
} else {
  main().catch((err) => {
    console.error(
      'webfetch-plus failed to start:', err,
    );
    process.exit(1);
  });
}

async function runCli(
  subcommand: 'install' | 'uninstall',
  scope: 'project' | 'global',
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
      `Installing webfetch-plus (${scope} scope)...`,
    );
    const log = await install(target);
    log.forEach(l => console.log(l));
    console.log(
      '\nDone. If you have not already, run `falk-document setup` to ' +
      'build the Docker image, then restart Claude Code to activate.',
    );
  } else {
    console.log(
      `Removing webfetch-plus (${scope} scope)...`,
    );
    const log = await uninstall(target);
    log.forEach(l => console.log(l));
    console.log(
      '\nDone. Restart Claude Code to take effect.',
    );
  }
}
