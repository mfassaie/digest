# Feature: Auto-publish

## Scope

### Boundaries

**In scope:**
- GitHub Actions workflow (.github/workflows/publish.yml)
- Triggered on push to main
- Bump patch version in package.json
- Commit version bump back to main with [skip ci]
- Build, lint, test
- Publish to npm using trusted publishing (OIDC, no token)

**Out of scope:**
- Minor/major version bumps (manual)
- Pre-release versions from branches
- CI-only workflow (lint/test without publish) for PRs
- Branch protection rules

**Anti-goals:**
- Not replacing manual version control for breaking changes
- Not publishing from any branch other than main

### Constraints

| Constraint | Detail |
|-----------|--------|
| Auth | Trusted publishing (OIDC). User must configure trusted publisher on npmjs.com linking this repo + workflow. |
| Loop prevention | Version bump commit must not re-trigger the workflow |
| Package manager | pnpm (matches project setup) |
| Node version | >=22 (matches engines field) |

### Dependencies

| Dependency | Type | Risk |
|-----------|------|------|
| Trusted publisher config | npmjs.com setting | Low. One-time setup linking repo + workflow. Must be done before first run. |
| GITHUB_TOKEN permissions | Workflow needs contents: write + id-token: write | Low. contents: write is default. id-token: write needed for OIDC. |
| pnpm-lock.yaml | Must be committed | Low. Already committed. |

### Feasibility

Trivial. Single YAML file with standard GitHub Actions steps.

### ADRs

None needed. Standard CI/CD pattern, no architectural decision.

## Define

### Behaviour

#### SPEC-017: Auto-publish on push to main

```gherkin
Given a push to the main branch
When the commit message does not contain [skip ci]
Then the workflow bumps the patch version in package.json
And commits the version bump with [skip ci] in the message
And pushes the commit to main
And builds the project
And runs the test suite
And publishes the package to npm via trusted publishing (OIDC)
And provenance attestations are generated
```

```gherkin
Given a push to the main branch
When the commit message contains [skip ci]
Then the workflow does not run
```

**Business rules:**
- Version bump: `npm version patch --no-git-tag-version`
- Commit message: `chore: bump version to {version} [skip ci]`
- Git config: use github-actions bot identity
- Build must pass before publish (fail fast)
- Tests must pass before publish (fail fast)
- npm publish with --provenance flag (generates supply chain attestations)
- Authentication via OIDC (trusted publishing), no npm token needed
- Workflow uses pnpm for install, npm for version bump and publish

#### SPEC-018: Workflow file structure

```gherkin
Given the workflow file exists at .github/workflows/publish.yml
When GitHub reads it
Then the workflow is valid YAML with correct GitHub Actions syntax
And it triggers on push to main only
And it has a single job with sequential steps
```

**Business rules:**
- runs-on: ubuntu-latest
- Node version: 22
- pnpm setup via pnpm/action-setup
- Node setup via actions/setup-node with pnpm cache
- Steps in order: checkout, setup pnpm, setup node, install, lint, build, test, version bump, commit + push, publish

### Interface

No API or CLI interface. This is a CI/CD workflow file only.

### Domain

No new domain entities. Configuration only.

### Technical Design

#### File

`.github/workflows/publish.yml`

#### Workflow structure

```yaml
name: Publish
on:
  push:
    branches: [main]

jobs:
  publish:
    if: "!contains(github.event.head_commit.message, '[skip ci]')"
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - Checkout (with token for push)
      - Setup pnpm
      - Setup Node 22 (with pnpm cache, registry-url for OIDC)
      - pnpm install --frozen-lockfile
      - pnpm lint
      - pnpm build
      - pnpm test
      - npm version patch --no-git-tag-version
      - git commit + push with [skip ci]
      - npm publish --provenance --access public
```

### Quality

#### NFR-007: Workflow must not create infinite push loops

The version bump commit includes [skip ci] in the message. The workflow
job has an `if` condition that skips when [skip ci] is present.

### Traceability

| ID | Source | Test type | Description |
|----|--------|-----------|-------------|
| SPEC-017 | Discovery | Manual | Auto-publish on push to main |
| SPEC-018 | Discovery | Manual | Workflow file structure |
| NFR-007 | Discovery | Manual | No infinite push loops |

Note: all tests are manual. GitHub Actions workflow files cannot be
unit tested. Verification is by inspection and first-run smoke test.

## Review

Gate Verdict: PASS

| Check | Result | Notes |
|-------|--------|-------|
| Completeness | Pass | All sections present. Interface and Domain justified as N/A. |
| Testability | Pass | All IDs manual (workflow YAML, verified by inspection + smoke test). |
| Consistency | Pass | [skip ci] in both commit message and job condition. |
| Traceability | Pass | All 3 IDs linked to discovery. |

Three-perspective review (lightweight, single-file feature):
- User: pushes code, npm updates automatically. No action needed.
- Developer: standard GitHub Actions pattern. pnpm + npm coexist (pnpm for install, npm for version/publish).
- Business: every push ships. No manual publish step to forget.

Specification locked. Ready for Plan.
