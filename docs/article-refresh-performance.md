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

## Writer contention — October 22, 2026

The next correction replaces a fresh editor process for every HTTP/MCP save with
one reusable background writer and an arrival-order queue per server. The worker
retains parsed article objects and control-store connections, refreshes Git state
**inside the filesystem lock** before each operation, and checks current authority
before preparation and at publication. Permission decisions are never cached.
Standalone editors and other servers still coordinate through the same directory
lock. The existing ten-second wait covers queueing, worker startup and external
lock acquisition together; this adds no admission/concurrency cap.

Atomic batches also populate their private Git index with one `update-index
--index-info` invocation. The branch compare-and-swap, private-index isolation,
revision checks, receipt identity, evidence verification and authorization fence
remain in place. Graceful worker shutdown drains admitted saves. A crashed worker
is replaced only after exit; an uncertain active operation is reported for an
identical retry, and a retained filesystem lock still requires documented recovery.

The baseline is `a58327e`, including the preceding batched article loader. All runs
used Node 24.22.1 on macOS arm64 and local temporary storage, approximately 2 KiB
of filler per article, OAuth-authenticated MCP and no measured retries. Mixed runs
had 48 readers and eight writers with a ten-second admission window. Their corpus
had 209 articles for single-article saves and 281 for ten-article batches. The
fixed burst used 32 writers, no readers and one iteration per writer (233 articles).
All rates and elapsed times include drain. The [raw record](benchmarks/writer-contention-2026-10-22.json)
retains engine fingerprints, intermediate runs and complete error/correctness data.

| Workload / observation                  |       Baseline |  Final source |
| --------------------------------------- | -------------: | ------------: |
| Mixed, one article: successful saves    |             29 |            42 |
| Mixed, one article: saves/second        |          2.232 |         3.605 |
| Mixed, one article: save p50 / p95      |  2.44 / 6.76 s | 1.87 / 2.15 s |
| Mixed, one article: elapsed             |        12.99 s |       11.65 s |
| Mixed, ten articles: successful saves   |             17 |            24 |
| Mixed, ten articles: saves/second       |          1.105 |         1.782 |
| Mixed, ten articles: save p50 / p95     | 3.79 / 10.57 s | 3.71 / 3.85 s |
| Mixed, ten articles: writer timeouts    |              1 |             0 |
| Mixed, ten articles: elapsed            |        15.38 s |       13.47 s |
| Fixed 32-writer burst: successful saves |             24 |            32 |
| Fixed 32-writer burst: writer timeouts  |              8 |             0 |
| Fixed 32-writer burst: save p95         |        10.55 s |        7.42 s |
| Fixed 32-writer burst: elapsed          |        11.04 s |        7.79 s |

Mixed save throughput increased about 62%, and its p95 fell about 68%. Ten-article
batch throughput increased about 61%. The final mixed, batch and burst runs verified
42, 240 and 32 article revisions respectively, with no request failures and all
receipt/conflict checks passing. A repeated final batch run verified another 240
revisions without errors, at 1.816 saves/second and 3.78-second save p95. The
intermediate persistent-worker-only results are retained separately; private-index
batching improved that candidate's ten-article throughput from 1.516 to 1.782 saves/s.

Read latency did not improve: single-article mixed read p95 rose from 157 to 172 ms,
and ten-article mixed read p95 rose from 191 to 195 ms. Every primary and repeated
final health probe completed within its four-second deadline, but health maxima
were variable: mixed 665 ms, batch 1.42 s, repeated batch 2.06 s and burst 28 ms.
The batch server event-loop maximum stayed at 87–101 ms. These measurements do not
establish lower read/health tails or production capacity. Server CPU/RSS now includes
the writer thread, whereas the baseline metrics excluded editor subprocesses; those
resource totals are not directly comparable.

Additional diagnostics reproduced health tails with a separate client socket pool.
A temporary timing probe placed the delay before the server's request handler,
after TCP connection; its instrumentation warnings are disclosed in the raw record.
The cause of those dispatch tails remains unresolved by this writer change.

The subsequent [read/health correction](#read-and-health-latency--october-22-2026)
reduces steady request costs and documents the remaining connection-acceptance tail.

Focused disposable checks verified:

- FIFO publication and captured queued inputs; independent worker instances and a
  concurrent standalone CLI retain cross-process serialization and exact readback.
- Cached state observes external commits, rejects stale revisions and invalid trees,
  recovers after repair, and rejects dirty worktrees without losing unrelated files.
- A conflict in a multi-article batch leaves no partial article or commit. Changed
  operation payloads conflict; identical retries recover the original commit after
  subsequent edits and after the evidence service goes offline.
- Human and agent identity stays per request. Revocation while queued or while
  evidence is pending prevents publication; a restored grant permits retry. Revoked
  credentials and sessions cannot recover a protected receipt.
- Queue and external-lock waits share the existing ten-second budget. Graceful close
  drains pending saves; idle/active worker failure restarts only after exit. A crashed
  publisher retains the directory fence for recovery.
- Git subprocesses launched from the worker inherit the verified managed lifecycle
  descriptor. Killing the parent during synthetic publication leaves the orphaned Git
  process holding that kernel fence until it exits.
- A disposable local bare remote verifies push success, durable local commits after
  push failure and identical-operation push retry without duplicate revisions.
- Standalone authenticated mode fails closed when its control database is missing;
  invalid deployment configuration retains structured writer errors.

No operator data, live configuration or deployment was changed by qualification.
These are local source observations, not release/container or hosted-storage
acceptance. Long sustained runs, larger histories and isolated hosted CPU/storage
remain separate qualification work.

## Read and health latency — October 22, 2026

The next correction reduces synchronous read-path work while retaining the writer
change above. A main-thread profile of the `f75a5e0` baseline attributed 28.1% of
samples to SQLite statement preparation and 21.0% to result extraction, almost
all in article search. These percentages include idle samples and are diagnostic
sample counts, not wall-clock CPU attribution. Connection reuse was already
working: the profiled baseline handled 7,023 external/internal requests with 119
new connections. The MCP bridge remains unchanged.

`ControlStore.prepare` retains compiled, fixed parameterized statements for hot
authorization reads. Each invocation executes again with current inputs and time;
no identity, scope, grant, query result or permission decision is cached. Admission,
response and publication checks retain their existing transaction boundaries.
Each connection owns its statements, which are released when it closes.

Search still selects the same ranked 400-section candidate set, prefers exact
titles, groups by article and applies the requested offset/limit. It now generates
snippets only for the returned articles, using each article's original winning
passage. Both steps share the adopted WAL snapshot; standalone readers open a
short read transaction when they do not already own one. FTS row IDs are bound as
SQLite integers because JavaScript numbers bind as REAL. A parity check caught
the incorrect passage selection caused by a REAL equality binding before the
final qualification runs. There is no index migration or new concurrency limit.

The [raw record](benchmarks/read-health-latency-2026-10-22.json) retains the baseline,
five qualified runs with matching engine hashes, profile summaries, a connection
timing diagnostic and correctness results. All runs used Node 24.22.1 on macOS
arm64, local disposable storage, OAuth MCP, 48 readers and eight writers. The
primary profiles used a ten-second admission window, approximately 2 KiB per
article, and either one-article saves (209 articles) or ten-article saves (281
articles). Rates include drain. Runs were sequential, with no measured retries.

| Workload / observation                | `f75a5e0` baseline | Optimized source |
| ------------------------------------- | -----------------: | ---------------: |
| One-article saves: read p95           |           168.9 ms |          89.4 ms |
| One-article saves: reads/second       |              253.2 |            659.0 |
| One-article saves: health p95         |           406.3 ms |          15.4 ms |
| One-article saves: health maximum     |           770.1 ms |          29.5 ms |
| One-article saves: event-loop maximum |            63.3 ms |          28.9 ms |
| One-article saves: saves/second       |              3.747 |            4.215 |
| Ten-article saves: read p95           |           209.0 ms |         112.0 ms |
| Ten-article saves: reads/second       |              185.0 |            567.3 |
| Ten-article saves: health p95         |            70.7 ms |          16.3 ms |
| Ten-article saves: health maximum     |            93.8 ms |          19.4 ms |
| Ten-article saves: event-loop maximum |            99.7 ms |          45.3 ms |
| Ten-article saves: saves/second       |              1.666 |            2.015 |

Read p95 fell about 47% for single-article saves and 46% for batches; read throughput
increased 2.60× and 3.07× respectively. A repeated mixed run measured 93.3 ms read
p95 and 15.1 ms health p95; a repeated batch measured 113.8 ms and 17.3 ms. The
30-second mixed run completed 121 saves with 108.5 ms read p95, 15.6 ms health p95
and a 36.1 ms health maximum. Across the five runs, all 272 saves, 758 historical
article readbacks and 819 health probes passed, with no measured request errors.
Every run also passed receipt retry and four-way revision-conflict checks. A final
diagnostic profile reduced statement-preparation samples to 1.5% while handling
17,567 external/internal requests with 111 new connections.

The maximum health delay is **not eliminated**. One repeated batch had a 620.7 ms
outlier even though its health p99 was 20.2 ms. A separate health-only timing probe
reproduced a 427.2 ms response: the client connected in 0.49 ms, the server emitted
its connection event after 403.5 ms, and its request event after 425.9 ms. The
remaining tail is therefore before request handling, predominantly before socket
acceptance is delivered to the server. The underlying scheduler/kernel mechanism
was not established. No platform configuration was changed. These observations
support lower read/health p95; they do not establish a worst-case latency bound,
a soak test, or hosted-storage capacity.

Focused disposable verification additionally covered:

- 389 exact search-result comparisons against the old implementation over a
  480-article fixture, including ordering, scores, snippets, anchors, prefixes,
  phrases, Unicode, missing/empty queries, topic/task filters, exact-title
  preference, grouping, truncation and pagination; six invalid-input comparisons.
- Index publication, deletion and recreation with pinned readers. A standalone
  read retained matching candidates/snippets when another connection published
  between the two steps; its next read adopted the update. Invalid standalone
  input released the temporary read transaction.
- One hundred warmed OAuth authorization calls still executed 1,200 queries and
  compiled no additional statements. Changes from another connection were visible
  to the next check: grants, session logout, remote-grant revocation, stopped runs,
  runtime-key and delegation revocation, expiry and disabled principals. Existing
  snapshots remained consistent, outer write transactions stayed open, and
  asynchronous snapshot callbacks were rejected.

Contract, formatting and static type checks passed. The synthetic fixtures,
diagnostic scripts and databases were removed. This is unreleased source work;
hosted-storage, container and deployment qualification remain separate.

## Authorization and search reuse — October 22, 2026

The follow-up to `cb33b2b` targets repeated authorization work and the cost of
searching a larger corpus. Within one synchronous authorization phase, token
validation now reuses its validated run, evaluates admission capabilities together,
and joins active-principal/run/key checks instead of repeating separate lookups.
Every protected operation, response and publication still checks current
authority; no authorization cache is shared across requests. The OAuth fixture reduced a complete HTTP read from 67 SELECTs
to 14; an MCP article read fell from 121 to 29.

Article search retains up to 64 recent results, with a 4 MiB serialized-result
budget. The key includes the query and all selectors. The indexed Git commit is
read inside the caller's existing pinned or standalone read transaction; a changed
commit clears the cache. Returned objects are copied, oversized results remain
complete and uncached, and authorization still runs on every HTTP/MCP request.
Ranking, snippets, grouping, truncation and pagination are unchanged. This helps
repeated searches; it does not make a new uncached query faster.

MCP captures the run's immutable agent definition during admission instead of
opening a separate authorization transaction to obtain the same metadata. Actual
API admission, response and save-publication checks still read current authority.
MCP can send stream headers before a tool finishes, so the final implementation
also checks the operation's current permission immediately before returning its
result. This closes a reproduced gap where a role was revoked after the inner API
had sent its reply. There are still five short authorization phases for an OAuth
MCP article read: the removed metadata phase is replaced by the result check.
Concurrent requests retain separate identities and result checks.

A larger experiment bypassed loopback HTTP for article reads. It reached about
5.6× local throughput, but regressed health responsiveness and saves on S3 Files.
Adding event-loop yields reduced event-loop delay without repairing those hosted
regressions. That direct-dispatch experiment was rejected; the final code keeps
the existing MCP HTTP bridge. Its adverse results remain in the raw record. No
request concurrency cap, persisted schema or host configuration was changed.

The [raw record](benchmarks/authorization-throughput-2026-10-22.json) preserves
baseline, qualified and exploratory results, including unsuccessful iterations.
The local runs use supported Node 24.22.1 on macOS arm64. All fixtures are
synthetic, load is closed-loop with 48 readers and eight writers, and rates include
drain. Search requests repeat one query, so the cache benefits this particular
workload. Save acknowledgements are checked against historical Git revisions;
each run also checks an identical retry and a four-way revision conflict.

### Local larger-corpus result

With 2,000 reader articles, about 8 KiB of filler per article and a 60-second
admission window, the repeated baseline measured 244.0 reads/second, 284.7 ms read
p95 and 66.3 ms health p95. The final source measured 900.7 and 886.8 reads/second
in two sequential runs: about 3.6–3.7× throughput. Read p95 was 184.1 and 177.3 ms,
and health p95 was 5.6 and 5.9 ms. All requests succeeded. The first baseline is
also retained; it measured 231.9 reads/second and 284.4 ms read p95.

| Local workload                                            | Reads/second | Read p95 | Health p95 | Saves verified |
| --------------------------------------------------------- | -----------: | -------: | ---------: | -------------: |
| 2,000 articles, 60 seconds, baseline repeat               |        244.0 | 284.7 ms |    66.3 ms |            184 |
| Same, final source                                        |        900.7 | 184.1 ms |     5.6 ms |            195 |
| Same, final repeat                                        |        886.8 | 177.3 ms |     5.9 ms |            193 |
| 200 articles, 30 seconds, final source                    |        952.1 | 107.5 ms |     8.5 ms |            108 |
| 200 articles, 30 seconds, final repeat                    |      1,214.7 |  84.1 ms |     6.4 ms |            134 |
| 200 articles, ten-article saves, 30 seconds, final source |      1,083.2 | 100.7 ms |     8.2 ms |             65 |

The five final-source runs verified all 695 saves, 1,280 historical article
revisions and 2,213 health probes with zero measured request errors. Their largest
health observation was 31.4 ms; this does not establish a worst-case bound or remove
the earlier connection-tail limitation. Larger-corpus writer throughput increased
modestly. In the smaller corpus, final-source save throughput varied from 3.39 to
4.20 saves/second against baseline observations of 4.02–4.20. The initial small
run's write regression was not repeated, but is retained: this is not a claim of
uniform improvement for every operation. The final small-corpus repeat preceded a
fresh baseline repeat to check order/host variation; both completed without errors.

Uncached search was checked separately against 2,000 articles and a 27.3 MB index.
Alternating baseline/candidate queries used 220 distinct but equivalent strings,
forcing misses. Baseline p50/p95 were 6.59/7.96 ms; final search code measured
6.64/8.06 ms. Repeating one query changed p50/p95 from 6.54/7.91 ms to 0.011/0.026 ms.
These 440 exact-result comparisons distinguish reuse from an uncached-search
speedup. An earlier authorization-only profile found FTS candidate extraction and
snippets dominated main-thread samples, motivating this cache; the raw summary
includes idle samples and is not normalized CPU attribution.

### Hosted compatibility and saturation diagnostic

Disposable Linux amd64 tasks used the existing deployed container's Node 24.21.0
runtime and dependency closure with the tested source files overlaid. This is
**not qualification of the current Node 24.22.1 minimum or a new release image**.
The client and server shared 0.5 vCPU and 2 GiB; the control database, Git content
and article index occupied newly created synthetic directories on S3 Files. The
workload used 1,000 reader articles, about 4 KiB of filler each, 48 readers, eight
writers and 60 seconds of admission. No live wiki content or service configuration
was changed.

The latest baseline observed 7.78 reads/second and 10.46 seconds read p95, 251
four-second health timeouts, 16 acknowledged saves and two `WRITER_BUSY` responses.
The final-source diagnostic observed 10.60 reads/second and 3.70 seconds read p95,
90 health timeouts, 21 acknowledged saves and three `WRITER_BUSY` responses.
Every acknowledged save, retry and conflict check passed, but these runs exited
nonzero because the workload still saturated this setup. They do not establish
hosted capacity or an error-free operating point. Earlier baseline/prototype runs
and an interrupted post-load verification are retained with their failures.

SQL wall-time profiles concentrated in the first control-store read and `COMMIT`,
consistent with remote-filesystem transaction-lock costs. Search reuse does not
remove these costs. The exact mechanism behind every health and connection tail
was not isolated. The direct-dispatch experiment's higher local throughput did not
justify its hosted regression, so it is absent from the final source. Further
hosted improvements require work on the remaining synchronous storage path or a
separately evaluated storage/runtime architecture; this task changed neither.

Focused disposable checks additionally verified 387 authorization comparisons,
810 search comparisons plus six invalid-input cases, snapshot publication and
invalidation, cache eviction, oversized uncached results, caller mutation isolation,
26 HTTP/MCP result comparisons and 32 concurrent identity checks. MCP tool results
were checked after internal reads; pending evidence reads and writes still reject
revoked authority, rejected publication leaves Git unchanged, and an identical
operation can succeed after authority is restored. No control read transaction
remained open across asynchronous work.

The cloud tasks stopped and removed their synthetic storage. Their disposable task
definitions and log streams were removed after retaining the measurements. The
source remains unreleased and undeployed.
