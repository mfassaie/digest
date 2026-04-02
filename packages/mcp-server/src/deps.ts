import type { PipelineDeps } from '@digest/shared';

// Injected dependencies (the ServerDeps pattern): the tool handlers pass
// these straight into the shared pipeline. The app wires the production
// store/settings/engine in; tests inject fakes.
export type ServerDeps = PipelineDeps;
