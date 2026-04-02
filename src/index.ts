#!/usr/bin/env node
import { main } from './server.js';

main().catch((err) => {
  console.error('webfetch-plus failed to start:', err);
  process.exit(1);
});
