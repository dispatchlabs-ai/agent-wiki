# Concurrent load testing

Run `npm run benchmark:load` for a quick, repeatable read/write stress test.
It starts a separate server process and drives authenticated OAuth agent calls
through MCP. All content, identities, credentials, Git history and databases are
synthetic and disposable. It never accepts an existing wiki URL or content path.

Use a supported Node version from the README, then:

```sh
npm ci
npm run benchmark:load
```

The default workload runs 48 readers and eight writers together for a ten-second
admission window. Requests already in progress finish afterward; fixture setup,
drain time and correctness checks make total runtime longer than ten seconds.
JSON results go to stdout and progress goes to stderr. To retain clean JSON:

```sh
npm run --silent benchmark:load > load-results.json
```

## Workload and measurements

Each reader repeatedly reads full article JSON four times and searches once.
Readers cycle through 200 seeded articles. Searches repeat the same `sensor` query
and limit, so this workload benefits from reuse of results for an unchanged index.
It does not measure a stream of unique search queries; measure uncached search
separately when that matches the intended workload. Each writer owns a separate article
or batch, reads its current revisions, and submits an actual Git-backed save.
There is no artificial pause between requests and no measured retry. A separate
client probe calls `/healthz` every 100 ms with a four-second deadline.

Results include per-operation success counts, throughput, p50/p95/p99/maximum
latency, separate failed-request latencies, error-code counts, drain time, server
event-loop delay, sampled server RSS and server CPU use. Throughput uses the
whole measured interval including drain; readers stop admitting work at the
configured deadline even if writers need longer to finish. CPU/RSS includes the
server and its worker threads, but excludes subprocesses and the load client.
Comparisons against older process-per-save source therefore account for different
parts of writer CPU/RSS; do not compare them as total resource use. A CPU value of
100% represents one core. Engine file hashes identify uncommitted candidate source.

After measurement, the runner reads back **every acknowledged article revision**,
including older revisions that another operation has since replaced. It retries
one completed operation and verifies that it returns the original receipt without
another commit. Four simultaneous edits to one shared revision must produce one
winner and three revision conflicts; the winning body and commit count are checked.
These checks are outside the timed workload and also run after a reader-only load.
Expected conflicts do not count as load errors. Any measured request failure or
correctness failure makes the command exit nonzero; a saturation result is still
printed when the correctness checks pass.

The runner removes its temporary directory and stops its server process group on
normal completion, failure, SIGINT or SIGTERM. A forced kill cannot guarantee
cleanup. No content remote is configured, and the runner never pushes content.

## Choose a load

| Variable                  |                Default | Meaning                                                                            |
| ------------------------- | ---------------------: | ---------------------------------------------------------------------------------- |
| `BENCH_READERS`           |                     48 | Concurrent read/search loops; zero disables them.                                  |
| `BENCH_WRITERS`           |                      8 | Concurrent read/edit/save loops; zero disables them.                               |
| `BENCH_WRITES_PER_WRITER` |                      0 | Maximum iterations per writer; zero repeats until the admission deadline.          |
| `BENCH_SECONDS`           |                     10 | Admission window in whole seconds.                                                 |
| `BENCH_ARTICLES`          |                    200 | Read corpus; writer articles and one conflict article are additional.              |
| `BENCH_BODY_BYTES`        |                   2048 | ASCII filler bytes per article, plus a short heading/operation marker; 100–45,000. |
| `BENCH_BATCH`             |                      1 | Articles per atomic save, from 1 to 10.                                            |
| `BENCH_TRANSPORT`         |                  `mcp` | `mcp` or direct `http` article APIs, both with OAuth agent authorization.          |
| `BENCH_TIMEOUT_MS`        |                  30000 | Per-request wall-clock deadline.                                                   |
| `BENCH_TMPDIR`            | OS temporary directory | Existing parent directory for a fresh, uniquely named synthetic fixture.           |

For a short investigation, run these profiles **sequentially** so they do not
compete for the same machine:

```sh
# Read ceiling, then mixed load.
BENCH_READERS=64 BENCH_WRITERS=0 npm run benchmark:load
BENCH_READERS=48 BENCH_WRITERS=8 npm run benchmark:load

# More contention, then the benefit and cost of larger atomic batches.
BENCH_READERS=128 BENCH_WRITERS=32 npm run benchmark:load
BENCH_BATCH=10 npm run benchmark:load

# One simultaneous burst, stopping when all 32 writer iterations finish.
BENCH_READERS=0 BENCH_WRITERS=32 BENCH_WRITES_PER_WRITER=1 npm run benchmark:load

# Separate MCP overhead from the underlying authenticated HTTP operations.
BENCH_TRANSPORT=http npm run benchmark:load
```

Repeat a chosen profile before drawing conclusions. Increase the article count,
body size and duration when the quick run passes. Compare the same source,
runtime, corpus, hardware/storage, client counts and batch size. Keep both failure
counts and latency tails: an apparent speedup that loses saves is not an improvement.

This is a fixed-client (closed-loop) test: a slow request delays that client's next
request. It locates useful concurrency and contention points, but does not model a
fixed external arrival rate or prove sustained production capacity. Read traffic
uses article APIs; browser HTML rendering, previews, conversation archives,
external evidence, reverse proxies and content pushes are outside this workload.
All clients share one synthetic agent identity.

For hosted-storage qualification, run the same source on an isolated host with the
intended CPU/memory allocation and set `BENCH_TMPDIR` to a disposable location on
the intended storage mount. The runner creates a new child directory; do not copy
production content or authentication data. Local-disk timings do not predict S3
Files latency. The existing [remote-storage measurements](article-refresh-performance.md#authorization-on-remote-storage--096)
show why that second measurement matters.

The [same-container storage experiment](storage-performance.md) compares local
disk with S3 Files, repeats both placements in reversed order, and separately
moves the control database while retaining the other files on their original
filesystem. Its SQLite transaction probe also records actual NFS operation
counts. This distinguishes a storage cost from a comparison between different
machines; it does not turn a saturated half-vCPU load into a capacity guarantee.

## First bottleneck: loading articles for each save

Before the October 22 source correction, each newly constructed `GitWiki` launched
one `git cat-file blob` process per article. A writer constructs a snapshot while
holding the existing repository lock, so subprocess overhead extended the time
all other writers waited.

Changed articles now use Git's [batch object interface](https://git-scm.com/docs/git-cat-file#_batch_output).
Their sizes are queried together, then content is read in groups of at most 4 MiB
plus protocol headers. The existing 4 MiB per-article bound is retained. The parser
uses byte lengths, preserving Unicode and trailing newlines. A single changed
article keeps the one-command path; unchanged article objects are reused. Revision
checks, atomic commits, authorization, retry receipts and writer serialization
are unchanged. There is no new request concurrency limit.

See [the measurement record](article-refresh-performance.md#concurrent-load-runner-and-git-object-batching--october-22-2026)
for the observed improvement and remaining contention.

## Writer contention

The next October 22 correction reuses a background writer with an arrival-order
queue. It refreshes the cached snapshot inside the existing filesystem lock and
keeps authorization fresh at work admission and publication. Queued requests and
external lock waits share the existing ten-second budget; there is no additional
concurrency cap. Atomic batches populate the private Git index in one command.
The standalone CLI retains the same cross-process lock and shared editor logic.

[Writer measurements and correctness checks](article-refresh-performance.md#writer-contention--october-22-2026)
compare mixed traffic, ten-article batches and a fixed 32-writer burst against the
batched-reader baseline. Longer runs and isolated hosted-storage qualification
remain useful next steps. A local successful burst does not establish unlimited
writer capacity or remove the documented `WRITER_BUSY` retry path.

## Read and health latency

The subsequent October 22 correction reuses compiled authorization statements
while executing every permission query against current state. Search ranks the
same 400-section candidate set and groups it by article, then extracts snippets
only for the requested page. Candidate selection and snippets share one SQLite
snapshot. There is no new request queue or concurrency cap.

[Read/health measurements and parity checks](article-refresh-performance.md#read-and-health-latency--october-22-2026)
compare the persistent-writer baseline with the optimized read path, including
repeated mixed/batch profiles and a longer mixed run. The runner fingerprints the
authorization, search and MCP bridge source alongside the writer and article loader.

## Larger corpora and authorization

The next correction consolidates current authorization queries and caches a
bounded set of search results for the indexed Git commit. MCP captures immutable
agent-definition metadata during admission, eliminating a redundant transaction;
each tool result checks the requested operation's current permission. See
[the local and hosted measurement record](article-refresh-performance.md#authorization-and-search-reuse--october-22-2026)
for repeated larger-corpus results, uncached-search checks, rejected direct-dispatch
experiments and hosted saturation limits. Local measurements and the compatibility
run on an older deployed runtime are not release qualification.
