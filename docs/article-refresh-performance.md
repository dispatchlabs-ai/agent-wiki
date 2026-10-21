# Article refresh performance

## Source correction — October 21, 2026

Concurrent article work could delay the lightweight health endpoint because every
request synchronously checked Git HEAD on the HTTP thread. MCP added a second
check through its loopback API request. A changed HEAD also parsed article links,
rebuilt history and updated the search index on that thread. Saves loaded the
whole wiki twice and parsed unchanged links again; previews restarted their
renderer workers after every successful job.

The correction moves ongoing Git refresh, Markdown projection and SQLite index
publication to one reusable worker. Concurrent readers share a refresh, and MCP
dispatch does not perform the redundant outer check. Previews need no Git refresh;
saves refresh after committing. Startup still loads and validates the initial
snapshot before listening.

The serving SQLite connection pins the same committed revision as the adopted
article tree. A worker publication cannot expose new backlinks or search results
with old article text. After adoption, the worker checkpoints and the serving
connection repins before the next refresh, allowing WAL recycling during sustained
updates. Invalid trees retain the last valid snapshot. A failed adoption requests
the missing snapshot again; an unexpected worker failure temporarily makes article
reads unavailable while liveness and authentication remain independent.

Each locked save now shares one wiki snapshot with evidence verification and
reuses cached links for unchanged articles. Successful preview workers stay warm;
failure, timeout and cancellation still discard the affected worker. The existing
preview deadlines, queue and memory/output limits remain in effect. The Git writer
lock, revision comparisons, atomic batches, operation receipts and authorization
checks are preserved. No request concurrency limit or dependency was added.

An embedding that selects an ephemeral `:memory:` article index now uses a private
temporary SQLite directory so the worker and serving connection can share WAL.
Normal server shutdown removes that directory. Configured index paths are unchanged.

## Focused qualification

The baseline was source `9e0152b`; the corrected source was measured on macOS
arm64 with Node 24.21.0. These are individual local observations, not production
capacity measurements or a replacement for the removed automated test suites.

The disposable fixture contained 48 fictional articles, five initial commits and
393,532 body bytes. One article was 55,338 bytes; the others were about 7.2 KB.
Bodies included headings, paragraphs, lists and internal links. The server ran in
a child process; the independent client probed `/healthz` every 100 ms with a
four-second deadline. No real wiki, archive, credentials or Git remote was used.

The common workload read all 48 articles concurrently, previewed eight drafts,
saved four successive four-article batches, and exercised receipt retries and
rejected edits.

| Observation                       |       Baseline | Corrected source |
| --------------------------------- | -------------: | ---------------: |
| 48 concurrent HTTP reads          |         541 ms |            94 ms |
| Eight previews                    |         576 ms |           155 ms |
| Four-article save, observed range | 2,044–2,101 ms |   1,112–1,184 ms |
| Maximum health latency            |         109 ms |           6.5 ms |
| Maximum serving event-loop delay  |         150 ms |            17 ms |

The corrected run additionally completed 48 concurrent MCP reads in 57 ms and
eight simultaneous, disjoint MCP saves in 6.81 seconds. Every saved article was
read back. All 159 health probes succeeded, including during those extra operations.

For a deterministic storage-delay reproduction, a synthetic Git wrapper delayed
each `rev-parse` invocation by 100 ms. The same common workload produced:

| Observation                                    | Baseline | Corrected source |
| ---------------------------------------------- | -------: | ---------------: |
| 48 concurrent reads                            | 6,506 ms |           208 ms |
| Health probes reaching the four-second timeout | 1 of 312 |         0 of 138 |
| Maximum completed health latency               | 1,073 ms |          12.9 ms |
| Maximum serving event-loop delay               | 1,107 ms |            14 ms |

The injected delay establishes the failure mechanism. It does not estimate a
hosted filesystem's latency or reproduce a particular CPU quota.

Focused synthetic checks also verified:

- An identical operation returns its original receipt, including when its
  evidence service is unavailable; changed payloads and stale revisions are rejected.
- An invalid link or a conflict in a multi-article batch leaves no partial article.
- Invalid committed trees preserve the last valid article and search index;
  a subsequent valid commit recovers publication.
- Worker index publication remains invisible until its matching article snapshot
  is adopted; a snapshot that was not adopted is sent again after the next request.
- A terminated refresh worker restarts, and concurrent refresh requests coalesce.
- Preview sanitization, successful worker reuse, zero-queue admission,
  cancellation replacement and timeout behavior remain effective.
- Forty continuously advancing commits in a separate one-article fixture fully
  checkpointed on every adoption. WAL size stayed at or below 255,472 bytes.
- Concurrent MCP clients using the same JSON-RPC request ID received their own
  results. The refreshed SDK rejected excessive input elements before validation
  while a maximum-sized legal article batch reached the writer's evidence check.

Static contract, formatting and type checks passed. Temporary repositories,
databases and diagnostic processes were removed after verification. Live rollout,
container CPU/storage qualification and release packaging are separate steps.
