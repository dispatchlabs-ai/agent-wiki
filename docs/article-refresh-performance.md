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

## Authorization on remote storage — 0.9.6

The 0.9.5 refresh correction did not address synchronous control-store reads.
An OAuth MCP article read performs 121 authorization SELECTs across request
admission, capability checks, the loopback API request and response checks.
Autocommit acquired and released a filesystem read lock for each statement.
Local disk qualification with a human session did not reproduce the cost of
this agent path on remote storage.

`ControlStore.read` now groups each synchronous authorization phase in one
short deferred SQLite transaction. Nested checks reuse their caller's transaction;
they cannot commit or roll back an outer publication transaction. The helper
rejects asynchronous callbacks. Every snapshot ends before the next await or
request, and publication still rechecks current authority inside its existing
immediate write transaction. Permission results are not cached and authorization
checks are not removed. No concurrency limit or deployment resource change was
introduced.

An isolated Linux amd64 task used the same S3 Files mount type, 0.5 vCPU and 2 GiB
allocation as the reported failure. It created only disposable fictional content
and identities. Sixteen OAuth authorization calls performed the same 192 SELECTs
in both versions: ungrouped calls took 2,144–2,164 ms; grouped calls took
184–185 ms. The equivalent local-storage observations were 9.4–10.0 ms and
7.4–7.8 ms, respectively.

A second isolated task compared 48 concurrent OAuth MCP article reads against
0.9.5 and the correction. Control data and fictional Git content were on S3 Files;
the derived article index was local. An independent client probed health every
100 ms with a four-second deadline.

| Observation                                        |     0.9.5 | 0.9.6 correction |
| -------------------------------------------------- | --------: | ---------------: |
| 48 concurrent OAuth MCP reads                      | 54,659 ms |         5,542 ms |
| Health checks reaching the deadline                |  13 of 15 |          0 of 36 |
| Maximum successful health latency in corrected run |         — |           192 ms |

The corrected task also completed eight concurrent, disjoint OAuth MCP saves in
54.5 seconds, using identical-operation retries for the existing writer lock.
All 475 health probes succeeded; the longest took 906 ms. Exact body readback,
idempotent retry and cross-origin rejection passed. All synthetic state was removed.

These single-run measurements isolate remote authorization locking; they are not
capacity guarantees or a full managed-deployment qualification. Exact package
acceptance and deployment receipts are separate release evidence.

Focused synthetic checks revoked an agent's grant while an external evidence
request was pending. Protected response data remained unavailable, and a pending
save left Git HEAD and article bytes unchanged. Restoring the grant allowed the
same operation to succeed. Revoking a human session during the same asynchronous
read also denied the response. No read transaction remained open across the wait.
Independent review checked nested snapshots, exception cleanup, synchronous-only
callbacks, cross-origin rejection and preservation of the publication fence.

## Concurrent load runner and Git object batching — October 22, 2026

The opt-in [load runner](load-testing.md) keeps authenticated OAuth/MCP readers,
searches and writers active together in separate client/server processes. It
records errors as well as latency and verifies every acknowledged revision,
idempotent receipt retries and conflicting saves. It uses only temporary synthetic
state and is separate from the static contributor checks.

The first run exposed another cost inside the writer lock: a fresh `GitWiki`
launched one Git process per article. The source correction batches changed-object
metadata and content reads, retains the existing per-article byte bound, and
preserves the one-object incremental path. It neither changes writer serialization
nor introduces a request concurrency limit. This is an unreleased source change;
it does not update an installed wiki.

The comparison used Node 24.22.1 on macOS arm64, local temporary storage, 200 read
articles, eight writer articles, one conflict article and approximately 2 KiB of
body filler per article. Forty-eight readers and eight one-article writers admitted
work for ten seconds. Baseline engine source was `1708414`; the candidate loader
fingerprint and full results are in the [measurement JSON](benchmarks/concurrent-load-2026-10-22.json).
These are individual observations, not production capacity or repeatability claims.

| Observation                              | Baseline | Batched source |
| ---------------------------------------- | -------: | -------------: |
| Successful saves, including drain        |        6 |             29 |
| Successful saves/second, including drain |    0.336 |          2.245 |
| Save p50                                 |   5.82 s |         2.74 s |
| Save p95                                 |  11.55 s |         5.12 s |
| Writer-lock timeouts                     |        5 |              0 |
| Article read p95                         |   145 ms |         154 ms |
| Health maximum                           |   792 ms |         889 ms |
| Measured interval, including drain       |  17.86 s |        12.92 s |

The observed successful-save rate increased about 6.7 times. The server completed
more writes, while read latency and health tails did not improve. Every acknowledged
save, exact historical readback, retry and conflict check passed. All 127 candidate
health probes succeeded. A preceding run of the batched algorithm also had no
request failures, but it is not a statistical repeatability study.

A separate ten-article batch run completed 18 saves and verified all 180 articles
in 15.28 seconds including drain, with one `WRITER_BUSY` failure. Its corpus had
281 articles because each writer owned ten articles. All 151 health probes passed.
Larger batches amortize commit work, but this observation still shows contention;
it is not evidence that saturation has been eliminated. Direct authenticated HTTP
also passed a smaller eight-reader/two-writer functional run.

Focused disposable Git checks passed byte batching across multiple groups,
Unicode, embedded header-like text, trailing and absent final newlines, unchanged
object reuse, the single-object path, the existing exact 4 MiB bound, oversized
rejection, invalid-tree snapshot retention/recovery, duplicate IDs, symlinks,
invalid filenames, packed objects and historical revisions. No operator content
or authentication data was used. Contract, formatting and static type checks
passed. Hosted storage, Linux container resource quotas, releases and deployment
remain separate qualification work.
