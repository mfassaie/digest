# Changelog

Release notes for the Orbit CLI, newest first.

## v3.2.0

- New commands
  - `orbit sync` — mirror remote state locally
    - Supports `--dry-run` to preview changes
    - Respects `.orbitignore` patterns
  - `orbit doctor` — diagnose config problems
- Performance
  - Parallelised manifest parsing
    - Up to 4x faster on large repos
    - Falls back to serial mode under low memory

## v3.1.0

Upgrade steps, in order:

1. Back up your `orbit.toml`
2. Run the migration
   1. Execute `orbit migrate --to 3.1`
   2. Review the generated diff
      1. Accept renamed keys
      2. Resolve any conflicts manually
3. Re-run your test suite
