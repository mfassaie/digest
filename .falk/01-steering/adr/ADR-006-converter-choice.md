# ADR-006: HTML-to-Markdown converter choice

- Status: Provisional (pending real-corpus validation in Phase B)
- Date: 2026-06-10
- Supersedes: implicit v1 choice of defuddle

## Context

v2 moves HTML→Markdown conversion into the container. The converter
determines the quality of the section structure that `falk_document_read`
exposes, so the choice was gated on a head-to-head eval
(`eval/`, run with `pnpm --filter @falk-document/eval run all`).

Corpus: 12 fixtures (docs-with-code, tables, news+boilerplate, deep lists,
SPA post-render snapshot, MathML, footnotes, CJK, 1.15 MB generated page,
3 malformed). 6 have curated golden Markdown. Metrics: ROUGE-L
precision/recall vs golden (extraction), heading-title F1 + structural
hierarchy (section quality — the headline criterion), code-fence/table
fidelity, token efficiency, latency/peak-RSS, image-size delta. Hard gates:
zero crashes/timeouts on malformed input; hierarchical headings on ≥90% of
docs fixtures. Non-extracting converters are baselines only (extraction is
an MVP requirement), shown but ineligible to win.

## Results (current corpus)

| Converter | Overall | Precision | Recall | Heading | mean ms | Eligible |
|---|---|---|---|---|---|---|
| mdream | 90.8 | 89.6 | 96.5 | 93.3 | 12 | yes |
| turndown-raw | 90.6 | 76.2 | 96.5 | 94.5 | 37 | baseline |
| readability+turndown | 86.7 | 94.0 | 94.1 | 81.1 | 70 | yes |
| rehype-raw | 81.6 | 78.9 | 94.7 | 94.5 | 77 | baseline |
| defuddle (v1) | 78.6 | 95.7 | 91.7 | 92.0 | 182 | yes |
| readability+rehype | 77.9 | 94.2 | 92.2 | 81.1 | 109 | yes |

All eligible converters cleared both hard gates. Go (JohannesKaufmann) and
kreuzberg adapters exist but were not run (binary/package not installed);
worth running before final lock if complex real-world tables prove to
matter (every converter scored 100 on fidelity here because the table
fixtures are GFM-representable).

## Decision

**Provisional winner: mdream.** It leads the section-structure dimension
the user prioritised (heading 93.3), has the best recall (96.5), is ~15×
faster than the incumbent, and adds the smallest image footprint among
Node-native options.

This is recorded as **provisional**, not locked, for three honest reasons:

1. **Precision gap.** mdream's precision (89.6) is the lowest of the
   eligible extractors — it leaks more boilerplate than defuddle (95.7) or
   readability+turndown (94.0). On the synthetic corpus the boilerplate
   volume is modest; on heavy real-world pages this gap could widen and
   flip the ranking. This is the key open question.
2. **Corpus realism.** Fixtures are hand-authored/generated with known
   goldens (rigorous for precision/recall, but lighter boilerplate than the
   real web). The plan's real captures (MDN/k8s/AWS/Wikipedia + real SPA
   post-render) were substituted with synthetic equivalents to get a
   working gate. Phase B's browser is exactly the tool to capture real
   fixtures cheaply — re-run the eval then.
3. **Weighting caveat.** mdream's win is partly driven by perf (10%) and
   image delta (10%), which barely matter in our architecture: conversion
   (12–182 ms) is noise next to browser render + network (hundreds of ms to
   seconds), and 5 vs 6 MB is nothing against a 555 MB base image. On
   quality dimensions alone the top four extractors are close.

**Operational note:** mdream is pre-1.0, single-maintainer (API-churn risk,
flagged in research). defuddle (incumbent, highest precision, mature) is the
recommended conservative fallback and remains the safe default if we ship
before real-corpus validation.

## Consequences

- The container's converter sits behind the `Converter` interface
  (`eval/src/converter.ts`, promoted to `container/src/converter.ts` in
  Phase B), so swapping the winner after real-corpus re-eval is a
  one-file change with no downstream impact.
- Phase B adds a real-captured fixture set via `capture.ts` and re-runs the
  eval before the converter choice is marked Accepted.
- Until then, implementation proceeds with the interface; the concrete
  default (mdream vs defuddle) is confirmed with the user.
