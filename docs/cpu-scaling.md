# CPU scaling with an independent load generator

Half a vCPU is a substantial constraint on the tested mixed article workload.
At 48 reader loops and eight writer loops, increasing the server from 0.5 to
2 vCPU raised article reads from 27.7–31.4 to 114.1–115.2 per second, and saves
from approximately 0.79 to 3.13–3.15 per second. Read p95 fell from 1.62–1.79
seconds to 421–432 ms; save p95 fell from 9.71–9.90 seconds to 2.75–2.76 seconds.
These ranges describe two runs of each configuration.

One vCPU delivered an intermediate improvement: 60.8–62.9 article reads/second
and 1.63–1.65 saves/second at that same concurrency. Neither 1 nor 2 vCPU had
request failures in those two runs. Half a vCPU had five health timeouts and one
health connection reset in its second run.

The results support 2 vCPU/4 GiB as a sizing candidate for this mixed workload.
Even that allocation had 6.52–6.53-second save p95 at the highest tested load of
96 readers and 16 writers. This is a starting point for workload-specific
qualification, not a guaranteed user count or latency target.

The October 22, 2026 experiment varies the server allocation across 0.5, 1 and
2 vCPU while keeping memory at 4 GiB, storage on task-local disk, and each load
generator in a separate 2-vCPU/4-GiB task. It addresses the sizing question left
open by the [storage experiment](storage-performance.md), where the server and
client shared half a vCPU.

## Method

All servers use the same optimized engine at source `1655a41` (identical engine
code to `d413382`), Node 24.22.1, Linux amd64, and the same existing dependency
installation. Dependency entries match the tested source's lockfile. The official
Node archive is verified by SHA-256 before extraction; the raw record retains
that digest and the diagnostic driver and plan digests. Each server has its own
allocation and private network interface.
Each server has a dedicated client; the three pairs run concurrently in the same
availability zone. Physical host placement is not controlled. These synthetic,
disposable tasks have no production content or control database mounted. This
is a source experiment, not a newly released image qualification.

Two passes exercise six reader/writer pairs: 1/0, 4/1, 12/2, 24/4, 48/8 and 96/16.
The second pass reverses the load-level order within each pair. Each run creates a
fresh Git repository, control database and search index. The corpus contains
1,000 reader articles with approximately 4 KiB filler, separate writer articles,
and a conflict target. Each run warms the read and search routes, then saves the
conflict target and verifies its historical revision to initialize the lazy
writer. This write is reported separately from measured saves. Admission then
lasts 45 seconds; requests already in flight drain before calculating throughput.

Reader loops perform four article reads and one search in each five-operation
cycle. The search phrase repeats, exercising the bounded search-result cache.
Writers read their own article revision then save a new body, without measured
retries. This is continuous closed-loop traffic with no think time, rather than
an external fixed arrival rate or a count of human users. Health probes arrive
approximately every 100 ms with a four-second deadline. Other request deadlines
are 120 seconds.

The load generator validates every acknowledged save using historical readback,
then checks an identical retry and four simultaneous conflicting saves outside
the measured interval. The retry check applies only when the measured run has
acknowledged saves. The conflicts must produce exactly one commit and three
stale-revision rejections, with a clean Git checkout afterward. Fixture removal
follows verification. A run with measured request errors still retains its
latencies and correctness results; it is counted as failing the no-errors
criterion.

CPU/RSS/event-loop measurements cover the server Node process, including worker
threads but excluding Git subprocesses. Additional container-stat snapshots cover
the server supervisor and subprocesses. Client CPU and event-loop delay are
recorded independently to detect load-generator saturation. Exposed cgroup and
ECS metadata counters are retained. The metadata service's statistics snapshots
can lag the measurement interval, so their timestamps matter.
[Fargate uses CPU shares](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html);
an unlimited inner cgroup quota or zero exposed throttling counters does not prove
unrestricted CPU capacity. The fixed 4-GiB memory size is supported by all three
CPU allocations.

## Reproduce

Use a clean checkout of the recorded source and supported Node/Git, then `npm ci`.
Copy [the diagnostic driver](benchmarks/cpu-scaling-2026-10-22.mjs) to
`scripts/cpu-scaling.mjs` and [the plan](benchmarks/cpu-scaling-plan-2026-10-22.mjs)
to `scripts/cpu-plan.mjs`. The driver derives its workload and verification from
`scripts/benchmark-load.mjs`; it adds a restricted control API for creating and
removing synthetic fixtures on the remote test server. It must never be exposed
publicly or aimed at a production wiki.

Start each server in its own CPU allocation with `CPU_BENCH_KEY` set to the same
random secret of at least 32 characters, then run
`node scripts/cpu-scaling.mjs --manager`. The default manager and wiki ports are
4318 and 4317. Allow them only between experiment tasks. The manager requires the
secret for every control action and accepts only fixture operations and fixed Git
verification commands. It automatically shuts down after 90 minutes.

On each separate client, set the same key and `CPU_BENCH_TARGETS` to a JSON array
with one object containing the matching server's `vcpu` and manager `url`.
Run `node scripts/cpu-plan.mjs` on each client. The plan also accepts multiple
targets for a sequential comparison, but this experiment uses one client per
server. Set `CPU_BENCH_SOURCE` to the immutable source SHA
when running without `.git`; use `CPU_BENCH_SMOKE=1` for a three-second fixture
check. Results are one JSON event per line and contain no access or refresh tokens.
Stop the managers and remove all experiment tasks and temporary artifacts afterward.

## Preflight observations

An initial read-only run reached the post-load conflict check with an
uninitialized writer. Its four first-write contenders returned one saved result
and three `WRITER_BUSY` errors, rather than revision conflicts. The run failed
verification and is excluded from the warm-state comparison. The first harness
did not retain that run's timing before verification, so it supplies no
throughput result. This is a real cold-start behavior, not evidence of incorrect
acknowledged content.

The final protocol explicitly warms and verifies the writer before timing and
also retains measured results if a later verification fails. A three-second
preflight on the half-vCPU server with the full 1,000-article corpus passed the
four-way conflict check after a 12.9-second initial write and readback. Warm-state
measurements below must not be used to claim that startup latency is negligible.

## Results

The [raw measurement record](benchmarks/cpu-scaling-2026-10-22.json) contains all
36 results, source fingerprints, process and container metrics, the full-corpus
smoke check, and the earlier cold-writer failure. All final runs completed
correctness verification; 31 also met the no-measured-errors criterion.

Values below are the two-run ranges, rounded. A single displayed value means
both results round to it. Latencies describe successful requests; failures have
separate distributions in the raw record. Rates include drain. The error column
sums both runs at that load level.

| Reader/writer loops | vCPU | Article reads/sec |     Read p95 | Saves/sec |      Save p95 | Errors (both runs)                    |
| ------------------- | ---: | ----------------: | -----------: | --------: | ------------: | ------------------------------------- |
| 1/0                 |  0.5 |         32.8–34.4 |     64–65 ms |         — |             — | 0                                     |
| 1/0                 |    1 |         78.4–79.2 |        13 ms |         — |             — | 0                                     |
| 1/0                 |    2 |       133.7–135.3 |         7 ms |         — |             — | 0                                     |
| 4/1                 |  0.5 |         23.6–23.9 |   318–320 ms |      0.74 |   1.53–1.55 s | 0                                     |
| 4/1                 |    1 |         56.3–56.4 |   168–176 ms | 1.50–1.51 |   0.78–0.79 s | 0                                     |
| 4/1                 |    2 |             118.8 |   101–111 ms | 2.56–2.59 |   0.49–0.51 s | 0                                     |
| 12/2                |  0.5 |         20.9–21.0 |  968–1009 ms | 0.83–0.87 |   2.77–3.06 s | 0                                     |
| 12/2                |    1 |         45.8–49.4 |   491–503 ms |      1.77 |   1.39–1.42 s | 0                                     |
| 12/2                |    2 |       106.2–109.6 |   272–281 ms | 3.04–3.07 |   0.82–0.83 s | 0                                     |
| 24/4                |  0.5 |         24.0–24.4 | 1196–1300 ms | 0.83–0.84 |   4.92–5.21 s | 2 health:ECONNRESET                   |
| 24/4                |    1 |         44.1–44.7 |   612–619 ms | 1.74–1.82 |   2.30–2.57 s | 0                                     |
| 24/4                |    2 |         69.1–70.1 |   376–379 ms | 3.36–3.41 |   1.18–1.20 s | 0                                     |
| 48/8                |  0.5 |         27.7–31.4 | 1619–1794 ms |      0.79 |   9.71–9.90 s | 1 health:ECONNRESET, 5 health:TIMEOUT |
| 48/8                |    1 |         60.8–62.9 |   734–801 ms | 1.63–1.65 |   4.90–4.91 s | 0                                     |
| 48/8                |    2 |       114.1–115.2 |   421–432 ms | 3.13–3.15 |   2.75–2.76 s | 0                                     |
| 96/16               |  0.5 |         32.2–33.0 | 2469–3176 ms | 0.74–0.78 | 13.39–14.21 s | 40 save:WRITER_BUSY                   |
| 96/16               |    1 |         80.9–85.4 | 1039–1119 ms | 1.51–1.52 | 11.26–11.28 s | 1 health:ECONNRESET                   |
| 96/16               |    2 |       168.4–171.3 |   554–564 ms | 2.79–2.83 |   6.52–6.53 s | 0                                     |

At 48/8, matched passes show approximately 3.7–4.1 times the article-read
throughput and four times the save throughput at 2 vCPU compared with 0.5 vCPU.
Read p95 is about 74–76% lower and save p95 about 72% lower. These are comparisons
within this protocol, not comparisons with the earlier same-container storage
experiment, which also had a different runtime, duration and startup protocol.

The highest-load half-vCPU runs acknowledged 86 saves and rejected 40 attempts
with `WRITER_BUSY`. All 86 acknowledgments verified. The one-vCPU allocation had
one health connection reset across its 12 runs; two vCPUs had no measured
request failures across all 12. No final run had an article-read or search error.
The observed connection resets are retained without assigning their exact cause
to CPU scheduling.

## Resource use and startup

All three servers reported an Intel Xeon Platinum 8259CL at 2.50 GHz. The client
processes used at most 4.42% of one CPU core; their CPU allocation was two cores
each. They were not CPU-saturated. One half-vCPU-server run's client event loop
had a 100 ms maximum delay; the other clients' maxima were below 18 ms.

| Server allocation | Approximate container CPU, in cores | Node peak RSS | Initial revision-read/save/readback | Maximum successful health latency |
| ----------------- | ----------------------------------: | ------------: | ----------------------------------: | --------------------------------: |
| 0.5 vCPU / 4 GiB  |                         0.499–0.500 |       759 MiB |                       11.99–13.10 s |                           3.565 s |
| 1 vCPU / 4 GiB    |                         0.995–0.999 |       902 MiB |                         5.49–5.73 s |                           0.922 s |
| 2 vCPU / 4 GiB    |                         1.072–1.813 |       949 MiB |                         4.14–4.23 s |                           0.373 s |

Container CPU is the change in cumulative CPU time divided by the time between
the ECS snapshot timestamps. Its sampled window can overlap setup and miss the
last portion of load. It includes Git, unlike the process-only metrics. These
approximate observations support the CPU constraint on the smaller allocations;
they are not precise throttle measurements. RSS is the largest sampled Node
process value across the 12 runs, not whole-task memory or a memory-sizing floor.

Health recorded 17,064 successes, five four-second timeouts and four connection
resets. All timeouts and three resets occurred on half a vCPU. The table's health
maximum covers successful responses only; it does not hide those failures or
establish a worst-case bound. The longest request drain was 11.87 seconds at
0.5 vCPU, 7.82 seconds at 1 vCPU and 4.88 seconds at 2 vCPU.

## Correctness and limits

Every one of 2,575 measured save acknowledgments matched its historical content
and revision: 394 on half a vCPU, 781 on one vCPU and 1,400 on two vCPUs. The 30
writer-bearing runs also verified that an identical retry returned the original
commit without creating another. All 36 runs verified a separate warmup save and
a four-way conflicting edit with exactly one winning commit, three stale
rejections and a clean Git checkout. Those 36 warmups and 36 conflict winners are
excluded from measured save throughput. The preflight cold-writer failure remains
recorded separately.

There is one allocated server/client pair per size and two passes on each pair.
This measures repeatability on those allocations, not host-to-host variation or
a long-running service. The corpus, repeated query, single synthetic identity
and closed-loop traffic limit generalization. More clients can change read/write
arrival pressure and request coalescing; throughput need not increase smoothly
with client count. No latency service-level objective was specified, so passing
the no-errors criterion is not a declaration of acceptable response time.

These local-storage results address CPU sizing after the separate NFS
transaction-cost finding. They do not show that added CPU removes that storage
cost. The disposable task disk is not a qualified persistent-storage design.
Production configuration, storage, releases and deployments were unchanged.

## Verification and cleanup

The local manager smoke check denied an unauthenticated request and verified
eight measured saves, an identical receipt retry and the four-way conflict
check. The full cloud record verifies matching source fingerprints, workload
parameters and driver payloads for all three server sizes. Required contract,
formatting and type checks passed on supported Node 24.22.1 before source
publication.

All 13 owned cloud tasks, including preflights, reached `STOPPED`. Retained logs
confirmed removal of 39 synthetic server fixtures and all 13 temporary source
directories. The 13 owned log streams and the dedicated security group were
removed and their absence verified. All 13 task definitions were deregistered;
AWS accepted deletion, with final observed status `DELETE_IN_PROGRESS`. That
remaining asynchronous metadata deletion is distinct from running compute.
No production storage was mounted and no task IAM role was granted.
