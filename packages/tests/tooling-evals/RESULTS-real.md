# Real-corpus converter eval

7 real captured pages (rendered HTML from the live container). No hand goldens — golden-free metrics targeting the open question (boilerplate leakage) plus heading structure and content retention. Readability is the neutral size reference.

| Rank | Converter | Score | Hier% | Headings | Leak/1k | Retention | ms | extracts |
|---|---|---|---|---|---|---|---|---|
| 1 | defuddle | 80 | 71 | 15 | 0.4 | 1.24 | 241 | yes |
| 2 | readability+rehype | 79 | 71 | 12 | 0.5 | 1.46 | 131 | yes |
| 3 | readability+turndown | 79 | 71 | 12 | 0.5 | 1.40 | 99 | yes |
| 4 | mdream | 58 | 100 | 23 | 1.8 | 1.74 | 24 | yes |
| 5 | turndown-raw | 56 | 100 | 21 | 0.9 | 6.35 | 47 | no |
| 6 | rehype-raw | 39 | 100 | 21 | 1.6 | 5.04 | 123 | no |

Leak/1k = boilerplate markers per 1000 tokens (lower is better — the precision signal). Retention = output size / Readability extraction (≈0.4–1.5 is healthy; lower drops content, higher leaks).

## Verdict

Defuddle: leak 0.4/1k, hier 71%, retention 1.24, rank 1/6.

Best eligible (extracting) converter: **defuddle** (score 80).

## Failures
- mdream: real-rust-blog:error
