# Contributing

Contributions are welcome. This project is currently sole-maintainer, so the
bar for merging is "does it fit the architecture and pass CI".

## Development setup

```sh
git clone https://github.com/mfassaie/digest.git
cd digest
pnpm install    # npm/yarn will be rejected by the preinstall guard
pnpm build
pnpm test
```

Node 22+ is required. Docker Desktop (or Engine) is needed only for end-to-end
tests that exercise container-based pipeline rules (`pnpm --filter @digest/e2e run e2e`).
The main test suite runs without Docker.

## Code style

- 2-space indent, ~80 columns.
- Imports ordered: stdlib, external, internal.
- Minimal non-obvious comments; cite ADR numbers as rationale markers.
- British English in prose (comments, docs, commit messages).

## Tests

Vitest, colocated alongside source (`*.test.ts` next to `*.ts`). Mock external
boundaries only (Docker, network). Run a single package with:

```sh
pnpm --filter @digest/shared test
```

## Submitting changes

1. Fork the repo and create a branch from `main`.
2. Make your changes. Add or update tests as appropriate.
3. Run `pnpm build && pnpm lint && pnpm test` locally.
4. Open a pull request against `main`.

Keep PRs focused: one logical change per PR. If a change is large, open an
issue first to discuss the approach.

## Security vulnerabilities

Do not open a public issue. Use
[GitHub private vulnerability reporting](https://github.com/mfassaie/digest/security/advisories/new)
instead. See [SECURITY.md](.github/SECURITY.md) for response SLAs and scope.

## Licence

By contributing you agree that your contributions will be licensed under the
[MIT licence](LICENSE).
