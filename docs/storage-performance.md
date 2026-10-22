# Local storage and NFS transaction costs

The October 22, 2026 controlled experiment confirms that SQLite transaction
traffic over this S3 Files NFS mount is a major read bottleneck. Moving all data
to task-local disk increased application read throughput about 3.4–3.6 times on
the same configured compute. Split placement showed that slow reads followed the
authorization database. Local disk alone did not make the half-vCPU stress load
pass: health and writer failures remain in the record.

This resolves the storage-versus-hardware ambiguity in the earlier
[hosted saturation diagnostic](article-refresh-performance.md#hosted-compatibility-and-saturation-diagnostic).
Every placement uses the same source, runtime and container. The experiment
changes storage placement without changing application authorization,
transaction boundaries or writer behavior. The [raw measurement record](benchmarks/storage-isolation-2026-10-22.json)
retains all runs, failures, source fingerprints and verification results.

## SQLite result

The repeated measurements identify a large NFS transaction-boundary cost on this
deployment. Query execution inside an already held snapshot is fast on both
filesystems. Reacquiring the snapshot repeatedly causes network locking, attribute
checks and reads that are absent from the local-storage path.

| Work, repeated twice per storage placement                    | Task-local disk | S3 Files / NFS |
| ------------------------------------------------------------- | --------------: | -------------: |
| 2,000 autocommit reads                                        |     9.6–14.2 ms |  17.89–18.38 s |
| 2,000 short read transactions                                 |    14.2–25.1 ms |  17.79–17.83 s |
| 2,000 reads in one held transaction, including its boundaries |      3.0–6.7 ms |   11.2–12.7 ms |
| 100 durable write transactions                                |  146.9–149.3 ms |  4.708–4.715 s |

Each NFS short-transaction round records exactly 2,000 `LOCK`, 2,000 `LOCKU`
and 2,000 `READ` operations, with 2,000–2,001 `GETATTR` operations. The held
transaction records one of each. Local rounds produce none of these NFS
operations. In the short NFS transactions, median first-lookup time is about
5.14–5.16 ms and median COMMIT time is 3.37–3.38 ms. The corresponding local
medians are approximately 0.003–0.005 ms and 0.002–0.003 ms.

Inside the held transaction, the lookup itself has a median of approximately
0.0012 ms on NFS and on the final local repeat. This intervention supports a
specific explanation: network filesystem locking and cache revalidation at
transaction boundaries dominate these reads. It does not attribute every
millisecond to the lock RPC alone or establish a universal cost for every NFS
server. All four databases passed reopened readback and integrity checks for
their 100 acknowledged writes.

## Application result

Each row contains two runs on the same half-vCPU, 2 GiB task. Rates count article
reads, with search traffic reported separately in the raw record. Latencies are
for successful article reads. Health failures and save outcomes are counts per
run; the measurement interval includes drain after the 60-second admission
window.

| Authorization database | Git and search index | Article reads/second |    Read p95 | Health failures | Acknowledged saves / writer-busy responses |
| ---------------------- | -------------------- | -------------------: | ----------: | --------------: | -----------------------------------------: |
| Local                  | Local                |            41.6–43.1 | 1.50–1.51 s |             0–5 |                              27–28 / 16–19 |
| NFS                    | NFS                  |            12.1–12.2 | 3.70–3.79 s |          78–165 |                                21–26 / 2–3 |
| Local                  | NFS                  |            54.2–54.6 | 1.19–1.21 s |             0–2 |                              17–18 / 25–28 |
| NFS                    | Local                |            10.0–10.3 | 4.14–5.01 s |         225–230 |                                  30–33 / 0 |

The control-database intervention is consistent in both directions. With
Git/index on NFS, moving control to local storage restores much higher read
throughput. With Git/index local, putting control on NFS restores the slow-read
behavior. Combined with the focused transaction timings and NFS counters, this
isolates the control store's synchronous network-filesystem operations as a
major cause of the observed read slowdown.

The split layout with local control has the highest read rate but the fewest
completed saves and the most writer-busy responses. It is not a uniformly better
configuration. This closed-loop workload changes request arrival pressure when
latency changes; it does not compare save reliability at a fixed external
arrival rate. Every application run failed the runner's no-errors criterion.
The local-storage runs also show that replacing NFS alone does not establish
adequate capacity for 56 concurrent clients on this task. CPU allocation was not
varied, so the experiment does not assign every remaining failure to CPU.
The subsequent [CPU scaling experiment](cpu-scaling.md) varies 0.5, 1 and 2 vCPU
with fixed memory, local storage and a separate load generator for each server.
It addresses compute sizing without changing this storage experiment's results
or establishing a production persistent-storage design.

Across all eight application runs, every one of the 200 acknowledged saves was
verified through its historical revision. All identical receipt retries and
four-way conflict checks passed. Health recorded 4,545 successes and 705 failures:
703 timeouts and two connection resets. The two resets occurred in one
local-control/NFS-content run; the other health failures were four-second
timeouts. There were 93 writer-busy responses and no measured article-read or
search errors. These are saturation measurements, not an error-free capacity or
crash-recovery qualification.

## Method

The application source is `d41338212a64554f98e4d36887019596887234d9`. One isolated
Linux amd64 Fargate task is configured with 0.5 vCPU and 2 GiB shared by server
and load client. The existing Node 24.21.0 runtime is held constant. This is a
compatibility experiment, not qualification of a release image or of the current
Node 24.22.1 minimum. Local checks of the experiment driver use Node 24.22.1.

The two filesystems are task-local disk storage, reported by `statfs` as
`0xef53` (the Linux ext filesystem family), and an S3 Files mount reported as
`0x6969` (NFS). The local path is not a RAM filesystem. These results do not
measure a separately provisioned EBS volume. Task-local data is disposable;
performance results do not establish a persistent-storage or backup design.

The driver announces the complete run order before measurement. Every database,
article, identity and Git repository is fresh synthetic data. Code and
dependencies stay on the same local filesystem in every run. No production wiki
is read or changed.

### SQLite transaction experiment

Four rounds run in local, NFS, NFS, local order. Each round creates a 100-row
SQLite database in WAL mode with `synchronous=FULL`, warms its prepared lookup,
and keeps a second connection open in the same process. It measures:

- 2,000 autocommit lookups.
- 2,000 short transactions, each containing one lookup, with BEGIN, lookup and
  COMMIT timed separately.
- The same 2,000 lookups inside one held read transaction, with its initial
  lookup and final COMMIT recorded separately.
- 100 durable write transactions, followed by a close, reopen, exact aggregate
  readback and `integrity_check`.

Linux NFS operation counters are sampled immediately around each measured loop.
They distinguish network reads, attribute checks, locks and unlocks. A held
transaction is only a diagnostic intervention: it is not a proposed change to
application authorization freshness or a transaction held across network awaits.

### Application load experiment

Each run uses the authenticated OAuth MCP load runner with 48 readers, eight
writers, 1,000 reader articles, approximately 4 KiB filler per article and a
60-second admission window. Readers alternate four article reads with one
repeated search. Writer articles are disjoint. Requests have a 120-second
deadline; health probes retain their four-second deadline. Throughput includes
drain time. Every acknowledged historical revision, an identical receipt retry
and a four-way revision conflict are verified after measurement.

The first four runs use local, NFS, NFS, local placement for all data. Four more
run with the control database local and Git/index on NFS, the inverse placement
twice, then the first split placement again. This separates the authorization
database from content and search storage, while counterbalancing order within
each pair. The control database's WAL and shared-memory files follow the database.

The benchmark is copied into disposable local code with two mechanical changes:
the control database may use a separate fresh directory, and the source revision
comes from the recorded source identifier. No engine file is modified. The
original and adapted driver hashes, plus engine hashes from each run, identify
the measured code. Full-load NFS counters include setup and verification as well
as measured traffic; the focused SQLite counters cover only their named loops.

The same configured CPU allocation and container are used throughout. Container
cgroup files expose an unlimited inner quota; the 0.5 vCPU value is the Fargate
task configuration, not a claim that an inner cgroup throttle counter measures
the whole allocation. Sequential runs cannot eliminate all ambient service or
host variation. Reversed order and repeated results test whether the effect is
consistent under the observed conditions.

## Verification and cleanup

All eight application runs used identical engine hashes and load settings. The
retained driver hash matches the experiment source. A smaller local harness check
exercised all eight placements and verification paths; it was not used as an NFS
measurement. Repository contract, formatting and type checks passed on supported
Node 24.22.1.

The cloud task exited successfully after recording all eight results and removing
its synthetic files and code. Cleanup also removed 5,699 owned S3 object versions
and 5,683 delete markers, then checked that the experiment's exact prefix stayed
empty. The temporary task definition and log stream were submitted for deletion;
the raw record includes the final verification state. Existing service resources
and persistent configuration were preserved.

## Reproduce

Install the repository dependencies with a supported Node version. Provide two
existing scratch parents on the intended filesystems, then run:

```sh
STORAGE_LOCAL_PARENT=/mnt/local-scratch \
STORAGE_NETWORK_PARENT=/mnt/nfs-scratch \
node docs/benchmarks/storage-isolation-2026-10-22.mjs > storage-results.jsonl
```

The [driver](benchmarks/storage-isolation-2026-10-22.mjs) creates uniquely named
directories beneath these parents and removes them on normal completion or a
handled interruption. A forced kill can require manual cleanup of those owned
directories. `STORAGE_SMOKE=1` runs a small harness check; using two local
directories in that mode does not establish an NFS result. The full experiment
can take substantially longer than its eight minutes of load admission because
it also creates fixtures, runs the SQLite experiment, drains traffic and verifies
history. Results are emitted incrementally as JSON lines.
