# Plan: Auto-publish

## Wave 0 - Setup (sequential)

### TASK-W0-001: Create publish workflow
- **Size:** S
- **Spec IDs:** SPEC-017, SPEC-018, NFR-007
- **Description:** Create .github/workflows/publish.yml with: trigger on push to main, [skip ci] guard, pnpm/node setup, install, lint, build, test, version bump, commit + push, npm publish with --provenance --access public. Permissions: contents: write, id-token: write.
- **Test type:** Manual (inspection + first-run smoke test)
- **Dependencies:** Trusted publisher must be configured on npmjs.com before first publish

## Coverage Matrix

| Spec ID  | Covering task(s) |
|----------|-----------------|
| SPEC-017 | TASK-W0-001     |
| SPEC-018 | TASK-W0-001     |
| NFR-007  | TASK-W0-001     |

All 3 spec IDs covered. Single task covers all specs (one YAML file).

## Audit

### Gate Verdict
READY

### Audit Notes
- **Coverage:** All 3 spec IDs covered by single task
- **Dependencies:** Trusted publisher on npmjs.com required before first run (external, manual)
- **Scope:** Single YAML file, no code changes, matches spec exactly
- **Architecture:** No ADRs for this feature, standard CI/CD pattern
- **Risk:** Low. Standard GitHub Actions workflow. First-run failure if trusted publisher not configured.

### Audit Date
2026-04-03

## Implementation Audit

### Gate Verdict
COMPLETE

### Audit Summary
- **Wave completeness:** Wave 0 complete (1/1 task)
- **Test suite:** 154 tests, 100% pass rate (no regression)
- **Spec coverage:** All 3 spec IDs covered (manual verification by inspection)
- **File created:** .github/workflows/publish.yml
- **Deviations:** None

### Audit Date
2026-04-03
