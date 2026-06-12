import type { PipelineDeps } from '@digest/shared';

// Injected dependencies (the ServerDeps pattern): the tool handlers pass
// these straight into the shared pipeline. The app wires the production
// store/settings/engine in; tests inject fakes. The container transport
// returns here in M9 — M4 runs the local pipeline only.
export type ServerDeps = PipelineDeps;
