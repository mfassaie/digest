export interface CliArgs {
  subcommand: 'install' | 'uninstall' | 'setup' | 'doctor';
  scope: 'project' | 'global';
  artefactRoot?: string;
  repoRoot?: string;
}

export interface ConfigTarget {
  mcpConfig: string;
  settings: string;
  localSettings: string;
  settingsDir: string;
}
