# Discovery: Auto-publish

Started: 2026-04-03
Status: complete
Activities: 1

## Problem Statement

Every push to main should automatically bump the patch version in
package.json, build, test, and publish to npm. This removes the manual
publish step and ensures the npm package is always up to date with the
latest code on main.

### Goals

1. Push to main triggers a GitHub Actions workflow
2. Workflow bumps patch version (0.1.0 -> 0.1.1 -> 0.1.2)
3. Workflow commits the version bump back to main
4. Workflow builds, tests, and publishes to npm
5. Authentication via npm trusted publishing (OIDC, no token)

### Anti-goals

- Not handling minor/major version bumps automatically (manual when needed)
- Not publishing pre-release versions from branches

## Research Findings

### CI/CD from public-release discovery -- 2026-04-03

The public-release discovery already researched the GitHub Actions
workflow structure:

- pnpm/action-setup@v4 for pnpm
- actions/setup-node@v4 with cache: 'pnpm'
- pnpm install --frozen-lockfile
- pnpm lint, pnpm build, pnpm test
- npm publish

For auto-versioning on push:
- `npm version patch --no-git-tag-version` bumps package.json without
  creating a git tag
- The workflow commits the bump and pushes
- To prevent infinite loops (push triggers workflow triggers push),
  use `[skip ci]` in the commit message or check if the last commit
  was from the workflow bot

### npm auth decision -- 2026-04-03 (revised)

User decision: npm trusted publishing (OIDC).
No npm token stored in GitHub. The GitHub Actions workflow uses OIDC
to authenticate directly with npm. Requires one-time setup on npmjs.com
linking the GitHub repo as a trusted publisher.

Setup:
1. Go to npmjs.com > package settings > Publishing access
2. Add a trusted publisher: GitHub Actions
3. Provide: repository owner (mfassaie), repository name (webfetch-plus),
   workflow filename (publish.yml), environment (leave blank for no environment)
4. The workflow needs `permissions: id-token: write` to request OIDC tokens
5. Use `--provenance` flag with npm publish for supply chain attestations
6. Requires npm CLI >= 11.5.1 and Node >= 22.14.0 (both satisfied)

## Assumptions

| # | Assumption | Confidence | Evidence | Consequence if wrong |
|---|-----------|-----------|---------|---------------------|
| 1 | Trusted publisher is configured on npmjs.com before first run | High | User chose this option | Workflow will fail on publish step with 403 |
| 2 | The workflow bot can push commits back to main | High | Standard GitHub Actions capability with default GITHUB_TOKEN | May need to adjust branch protection |

## Gap Analysis

No blocking gaps. The workflow is standard GitHub Actions CI/CD.

## Summary

Single GitHub Actions workflow (.github/workflows/publish.yml) triggered
on push to main. Bumps patch version, commits, builds, tests, publishes
to npm via trusted publishing (OIDC). No npm token needed. Loop
prevention via [skip ci] in the version bump commit message.
