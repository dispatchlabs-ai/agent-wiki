# Verification

## Source alpha preparation — September 9, 2026

- Clean exported source: `npm ci --ignore-scripts` and `npm run check` passed
  all 22 tests on Linux x86-64 with Node 24.19.0.
- A clean-clone rehearsal also passed the complete check.
- The example started, returned articles and both synthetic trace types, saved an
  article, and did not push. Ambient content/trace/push settings did not redirect
  the example into the sentinel archive.
- After stopping the process, copied the full content Git repository and trace
  archive to new paths. The production entry point restored the saved edit and
  catalog and rebuilt the SQLite search index.
- Gitleaks 8.30.1 found no secrets in the reviewed history. A separate private-
  identifier scan and synthetic fixture inspection found no source-data exposure.
- Independent runtime security review found no concrete release blocker within
  the documented trusted-operator model. Independent source-release review
  accepted the alpha after example isolation and dependency-policy clarification.
- Dependency freshness and license inventory are recorded in [dependencies](dependencies.md).
  `npm audit` reported zero known vulnerabilities.

These are historical, pre-publication source-alpha checks. At that checkpoint,
hosted GitHub CI, private vulnerability reporting, branch/tag policies, signed
releases, and public visibility had not yet been configured or verified. No package or container release was prepared.

## Initial verification

September 9, 2026, on Linux x86-64 with Node v26.8.1.

- `npm run check`: formatting and 14 automated tests passed. Coverage includes
  coordinated edits, stable retry receipts, stale revision rejection, concurrent
  HTTP writers, failed remote pushes, metadata preservation, directory moves and
  first-parent merges, dirty-tree protection, compare-and-swap, malformed committed
  links, index transaction rollback/recovery, executable frontmatter rejection, HTML sanitization, heading/search anchor
  agreement, incremental indexing/deletion, HTTP access/size limits, and WebMCP
  registration/execution against the HTTP API.
- Native WebMCP in the Codex in-app browser: discovered all four tools; searched
  “soil”; read a fictional person and its backlinks/history; saved an edit; retried
  the same operation and received the same commit; rejected a stale revision.
- Browser editor: loaded current Markdown, saved a revision, reported local/remote/
  publication status, and showed revision 3 on the current article. Article layout
  was visually checked at desktop and a 390-pixel viewport override; no horizontal
  overflow was observed. No production content was involved.
- `npm run benchmark`: 10,000 synthetic articles / 50,000 initial sections, disk
  SQLite. Initial indexing 5,446 ms; one changed article 11.1 ms; 100 warm queries
  median 4.2 ms, p95 8.3 ms. These measurements exclude Git refresh, HTTP and rendering;
  they are not end-to-end latency or cross-machine guarantees.
- Workspace registration: workspace Git/LFS checks and all 17 Python tests passed.

The browser example used a separate ignored content repository; the committed
example corpus remains the original three synthetic articles. No persistent
service or network deployment was installed. Node 24 is the declared minimum;
the initial execution checks used Node 26, not a version matrix.

## Reproduce serving costs

`npm run benchmark:serve` creates an isolated synthetic repository with 200 articles,
50 subsequent commits, and a roughly 1 MiB / 2,001-record trace. It reports startup,
cold/warm trace reads, trace search, and HTTP read median/p95 for four concurrent
readers across ten further edits, plus event-loop p99 and sampled RSS. Increase
`BENCH_ARTICLES`, `BENCH_COMMITS`, and `BENCH_RECORDS` to explore larger workloads.
The HTTP client shares the server process; memory includes both and fixtures, and
RSS is sampled rather than peak. These are reproducible observations, not load or
capacity guarantees. Source archives and deployed instances are never used.

Observed September 9, 2026 on Linux x86-64 / Node 26.8.1 with 1,000 articles,
201 initial commits and 10,001 trace records (6.9 MB): startup 3,862 ms; cold/warm
trace reads 223/7 ms; trace search 24 ms; four-reader edit batches median/p95
73/77 ms; event-loop p99 74 ms; sampled RSS 311 MiB. Git refresh remains synchronous;
these results do not justify treating the SQLite-only timings as serving latency.

## Focused follow-up checks — September 9, 2026

All 26 core tests passed on Node 24.19.0, 26.6.0 and the existing 26.8.1 runtime.
The Chromium editor smoke test passed on Node 24.19.0 with Playwright 1.62.1:
module loading, a saved edit, and a second unchanged save retaining revision 2.
Formatting passed. This browser test does not claim native WebMCP compatibility.

## Correctness and degraded operation — September 10, 2026

Added end-to-end receipt lifecycle and old-receipt compatibility regressions;
missing/incompatible/corrupt/locked/rebuilt trace-index checks; 25 growing captures
with logical-group pagination; identical dialogue on distinct branches/events;
verified-prefix fallback; independent catalog rebuilding and warm reads without
metadata scans; and disk-spooled large explicit ranges excluded from the page cache.
`npm run check` now includes source-wide JavaScript/JSDoc type checking and
compile-time required-field regressions. The final check passed all 45 core tests;
all five Chromium suites passed, including grouped-hit provenance links.

The serving benchmark now accepts `BENCH_SNAPSHOTS` (default 100), measures cold and
warm catalog pages plus a full requested range, and reports OS process-lifetime
peak RSS (`process.resourceUsage().maxRSS`) alongside sampled RSS. Peak includes
fixture creation and worker threads; it is not isolated per-request memory.

Observed on Linux x86-64 / Node 26.8.1 with 1,000 articles, 201 initial commits,
1,000 snapshots and a 10,001-record main trace (6,877,813 bytes): cold/warm catalog
34/11 ms; complete range 784 ms; article read p95 81 ms; event-loop p99 101 ms;
peak RSS 333 MiB. This larger catalog workload is not directly comparable with
prior one-snapshot benchmarks. Git refresh remains synchronous; cold rendering
still parses a complete snapshot. These are measurements, not capacity guarantees.

## Authentication deployment integration — September 12, 2026

Integrated Google/local authentication with the exact v0.3.2 reader, keeping its
responsive UI, rich Markdown, original evidence, media ranges, previews and MCP.
The authenticated tests also exercise MCP caller isolation, reader-write denial,
original evidence API protection, delayed-response revocation and the portable
writer lock. Browser coverage includes invitation, password setup, direct grants,
login, logout and password changes alongside the existing reader suites.
The deployment runbook owns live verification; synthetic checks do not establish
a working Google client registration.

## 0.4.0 release review — September 13, 2026

Independent source/OSS and security reviews covered current authentication,
remote OAuth, permissions, UI data exposure, licensing, and portability. A
confirmed outsider directory-disclosure bug was fixed with a regression that
failed before the fix and passes afterward. Explicit agent-only invocation still
works. No additional blockers were confirmed within this bounded review.
It was not an external identity-provider assessment or penetration test.
The source review found no private infrastructure identifiers in the current tree;
private engineering history remains separate from public Git history.

The public `scripts/check` gate installs the lockfile, builds browser assets, runs
format/type/application checks and Chromium tests, then audits production dependencies.
Automatic Linux checks run anonymously from public `main` through Palm's isolated
local runner with Node 24.19.0; the exact SHA receives `omarchy/linux` status.
Release candidates also run this gate on a Mac. GitHub Actions is disabled.
