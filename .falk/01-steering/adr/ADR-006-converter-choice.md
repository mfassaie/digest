# ADR-006: HTML-to-Markdown converter choice

- Status: Accepted (confirmed on a real-captured corpus, 2026-06-10)
- Date: 2026-06-10
- Supersedes: implicit v1 choice of defuddle

## Context

v2 moves HTML→Markdown conversion into the container. The converter
determines the quality of the section structure that `read`
exposes, so the choice was gated on a head-to-head eval
(`eval/`, run with `pnpm --filter @digest/eval run all`).

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

**Default for Phase B: defuddle (incumbent). Final choice re-reviewed after
the Phase B real-corpus eval.**

The synthetic leaderboard put mdream first, but that ranking is inflated by
perf (10%) and image-size (10%) — dimensions that are near-irrelevant in our
architecture, where conversion (12–182 ms) is noise next to browser render +
network. On capability that actually serves v2, defuddle is the stronger
choice:

- **Metadata for free.** `Defuddle` returns title, description, author,
  published date, site, domain, favicon, lead image, language, wordCount and
  parsed schema.org data alongside the markdown — this populates `meta.json`
  and gives the read-engine a `description` summary fallback. mdream and the
  turndown/rehype pipelines return none of this; we would build it
  separately.
- **Standardisation.** defuddle normalises footnotes, headings, code blocks
  (with language detection) and math — directly serving the section-structure
  goal, and the reason it scored 92 on headings without post-processing.
- **Highest extraction precision** (95.7) — it strips boilerplate most
  thoroughly (configurable removal of ads/social/low-scoring/content
  patterns).
- **Site-specific extractors** (YouTube transcripts, Reddit, GitHub, HN,
  Twitter/X) the generic converters lack.

mdream remains the leading challenger (best recall + heading + speed) and the
`Converter` interface keeps the swap to a one-file change. The deciding
question — whether defuddle's precision lead holds on heavy real-world
boilerplate — is answered by the Phase B real-corpus eval.

### mdream caveats (why it is not the default)

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

## Real-corpus confirmation (2026-06-10)

7 real pages were captured as rendered HTML through the live container
(MDN ×2, Wikipedia, Kubernetes docs, Python docs, a JS SPA, a blog) and
scored golden-free on the open question — boilerplate leakage — plus
heading structure and content retention (Readability as a neutral size
reference). Full table in `eval/RESULTS-real.md`.

| Converter | Score | Leak/1k | Retention | Note |
|---|---|---|---|---|
| **defuddle** | **80** | **0.4** | 1.24 | rank 1; lowest leakage |
| readability+rehype | 79 | 0.5 | 1.46 | |
| readability+turndown | 79 | 0.5 | 1.40 | |
| mdream | 58 | 1.8 | 1.74 | ~4.5× more leakage; **errored on the blog** |
| turndown-raw (baseline) | 56 | 0.9 | 6.35 | keeps everything |
| rehype-raw (baseline) | 39 | 1.6 | 5.04 | keeps everything |

The synthetic eval's mdream lead was an artefact of perf/image weighting and
light synthetic boilerplate. On real pages the predicted precision gap
materialised: **defuddle leaks ~4.5× less boilerplate than mdream** and was
the only extractor with zero failures (mdream threw on the blog page). On
the SPA, defuddle stripped the login/footer chrome (leak 0.0) where mdream
kept it (leak 7.6). Decision **confirmed: defuddle**.

## Consequences

- The container's converter sits behind the `Converter` interface
  (`eval/src/converter.ts`, promoted to `container/src/converter.ts` in
  Phase B), so swapping the winner after real-corpus re-eval is a
  one-file change with no downstream impact.
- Phase B adds a real-captured fixture set via `capture.ts` and re-runs the
  eval before the converter choice is marked Accepted.
- Until then, implementation proceeds with the interface; the concrete
  default (mdream vs defuddle) is confirmed with the user.
