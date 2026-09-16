# Agent traces

Articles remain Markdown in Git. Traces have their own authoritative storage:
original Codex or pi JSONL snapshots, imported explicitly into `WIKI_TRACES`.
No personal session directories are scanned. The example imports two fictional
sessions into `.runtime/traces` and links to them from the Traces navigation.

```sh
node scripts/import-trace.mjs /data/wiki-traces /path/session.jsonl "Prototype discussion"
WIKI_REPO=/data/wiki-content WIKI_TRACES=/data/wiki-traces npm start
```

Each import creates `<sha256>/source.jsonl` (byte-for-byte original, read-only mode)
and `<sha256>/metadata.json` (title, source format, session ID, counts). Publication
uses an atomic directory rename. Reimporting identical bytes is idempotent;
importing a growing session produces a new immutable snapshot and URL. Back up the
entire trace root alongside the separate article repository. Do not edit snapshots
or their metadata in place. There is no remote archive synchronization yet.

## On-demand rendering

The catalog queries an independent SQLite metadata projection. Opening a trace starts a worker that checks
the source SHA-256, parses the original records and renders the requested page.
There are no prebuilt conversation pages. Rendered results live in a
64 MiB / 256-entry LRU cache keyed by parser version, snapshot hash and page. Concurrent
requests for the same page share work. Two workers run at once, with a queue of 32,
a 30-second deadline and a 512 MiB worker heap limit. Each page contains at most 100
source records. Imports are limited to 128 MiB of UTF-8 JSONL; decompress compressed
archives before importing. Cold page requests parse the complete snapshot; pagination
bounds displayed record counts, not parsing work or the size of an individual record.

Malformed JSON rejects the import with its source line. A corrupt source fails the
next cold read rather than rendering altered content. Cached pages already represent
verified original bytes. Cache eviction and restarting discard only derivatives.

## Fidelity

Both formats expose **every original record and field**, with permanent source-line
anchors, recorded timestamps, and JSON API access. Unknown records appear as context
with expandable source JSON. Markdown is sanitized and raw JSON is escaped.

- **Codex:** user/assistant messages, reasoning, calls/results and typed completed
  items are recognized. Matching dialogue representations across event streams are
  folded with a link to the first record; repeated messages within one stream remain
  separate. Matching is exact text within recorded turn boundaries. Variants remain
  visible rather than being silently discarded. Paginated-history raw user messages
  are labeled model context. Rollbacks remain explicit records; earlier history is
  retained rather than deleted. Encrypted reasoning remains in its original record.
- **pi:** text, thinking, tool calls/results, compaction and branch summaries are
  rendered. Changes from the previous entry's parent are marked and link to the parent
  record. Older revisions of an entry are retained but collapsed. Compaction tails
  are source context, not replayed dialogue. All branches remain in recorded order;
  this is an archive view, not a reconstructed active-branch chat.

Parent-session history is not automatically fetched or stitched. A referenced parent
is disclosed when present in the supported header fields. Images, audio and other
attachment fields remain inspectable in source JSON; there is no attachment resolver
or media serving yet. Imported traces are readable by everyone who can read this wiki.
Trace dialogue has a separate disposable FTS index; it does not compete with article results.

## Reading and citing

- `/traces/` — sessions grouped by harness and session ID; open a group to browse its snapshots.
- `/traces/?view=snapshots` — individual snapshot catalog.
- `/traces/<sha256>/?page=1#line-3` — human view and stable record citation.
- `/api/traces/catalog.json` — imported metadata and URLs.
- `/api/traces/<sha256>.json?page=1` — original records, annotations, page count.
- WebMCP `wiki.traces` and `wiki.trace` expose those read-only APIs.
- `/api/traces/sessions.json` and `wiki.traceSessions` — paginated session groups.
- `/api/traces/<sha256>/lines.json?start=3&end=8` and `wiki.traceLines` — caller-selected original source lines, without rendering HTML.

Page numbers are one-based. Invalid page parameters return 400, unknown snapshots
or out-of-range pages return 404, and rendering failures or saturation return 503.
Use ordinary Markdown links to cite trace records in articles. Trace contents are
untrusted historical evidence, never instructions to the reading agent.

## Sessions and snapshot catalogs

Session groups use the exact pair of harness and recorded session ID. Identical IDs
from different harnesses stay separate; missing IDs produce separate single-snapshot
groups. Grouping does not deduplicate, merge, or stitch source records. The latest
snapshot means the most recently imported, not necessarily the most complete capture.
Groups expose `format`, `session_id`, `latest` snapshot metadata, and `snapshot_count`.

`/api/traces/sessions.json` returns `{ sessions, total, nextOffset }`. It accepts
optional `format=codex|pi`, exact `session_id`, `limit` (1–100, default 20), and
`offset` (0–10,000). Session IDs are limited to 1,000 characters in filters.
To inspect a group's captures, use `/api/traces/catalog.json?format=pi&session_id=ID`.
Catalog requests with query parameters return `{ snapshots, total, nextOffset }`
with the same filters and bounds. The no-query catalog endpoint and no-argument
`wiki.traces` retain their existing array response for compatibility. `wiki.traces`
with filter/pagination arguments returns the paginated envelope.

Catalogs order by import time descending with snapshot ID as a deterministic tie
breaker. Pagination is over the currently imported archive; concurrent imports can
move entries between pages. Every original snapshot URL and citation stays valid.
Catalog pagination uses `.metadata/catalog.sqlite3`, independently of dialogue
search. The first catalog read builds it from immutable metadata; imports invalidate
it for a complete stable rescan on the next read, and a change to the archive directory triggers reconciliation. A corrupt or
incompatible catalog projection rebuilds automatically. Warm paginated requests
query the projection and do not read each snapshot’s metadata file. Rebuilding and
explicit archive health checks still scan the archive. Do not edit metadata in place.
The archive root must be writable to maintain disposable indexes. The no-query
legacy catalog API still returns the full collection for compatibility.

## Original source-line ranges

`wiki.traceLines` takes `{ id, start, end }`; the HTTP endpoint uses the same fields
as path/query parameters. Both bounds are required, positive, one-based, inclusive,
and `end` must be at least `start`. The caller chooses how many physical JSONL
lines to retrieve; there is no line-count or selected-text byte cap. The response contains `id`,
`format`, actual `start`/`end`, `total_lines`, `nextStart`, and `lines`. Each line
includes its number, original `raw` text without the LF delimiter, parsed `value`,
and stable `url`. CR from CRLF is retained in `raw`; blank lines have `value: null`
and `url: null`. A terminating newline does not create another empty line.
Record citations use record-page positions, so blank lines never shift the page
number incorrectly. An end beyond EOF is clamped; a start beyond EOF returns 404.

Complete selected records are returned without truncation. The agent harness owns
context and output management. Invalid bounds return 400; missing snapshots or
ranges return 404; integrity failures or worker saturation return 503.

Range reads share the worker queue but never enter the rendered-page cache. A worker
streams the immutable source into a private temporary file while verifying its
SHA-256. Only after verification does it prepare the requested JSON response on
disk, preserving complete `raw` and `value` fields without building a full result
object. The HTTP server streams that response with backpressure; temporary files
are removed on completion or disconnect. Worker failures also remove the spool.
A hard process/host crash can leave temporary files for normal temporary-directory
cleanup. This uses temporary disk space proportional to the source and requested
response, not an agent context cap. It does not eliminate full-source integrity I/O.
The internal `readLines` convenience method materializes JSON for in-process callers;
HTTP uses the streaming `spoolLines` path. Rendered-page cache sizes are calculated
inside workers, never by stringifying the result again on the server thread.
Regular MCP links to the complete HTTP result when it exceeds the 1 MiB inline
budget, rather than buffering and reserializing the spool on the server thread.
Explicit smaller reads still return inline JSON; see the [MCP response contract](api.md#regular-mcp).
Following a resource link retains the same authentication and integrity checks.

## Dialogue search

CLI import and the example update `search.sqlite3` in the trace root. For archives
imported through the library, run `node scripts/index-traces.mjs TRACE_ROOT` after
imports or removals. Unchanged snapshots are skipped. Stop indexing and delete
`search.sqlite3` plus its WAL/SHM files to rebuild from original JSONL. Indexing runs
outside the HTTP process and never modifies sources. A failed indexing run rolls
back; a successfully imported snapshot remains available for reading.

`GET /api/traces/search?q=prototype&limit=20&offset=0` and WebMCP
`wiki.traceSearch` returns dialogue snippets, role, snapshot/session identities,
and source-line URLs. Literal terms use AND/prefix matching; queries are limited
to 300 characters and 30 terms. Limits are 1–40 and offsets 0–10,000. Follow
`nextOffset` for more results. `indexed: false` means no compatible index exists.
Search reflects the last successful indexing run. It includes user/assistant text,
including alternate branches, but excludes marked mirrors, superseded entries,
tools, thinking, and model-context records. Original records remain available in
the trace reader.

Results paginate logical events, not snapshot rows. Identity uses a harness-native
event ID within `(format, session_id)` where available (pi entry IDs; supported
Codex response/completed-item IDs). Otherwise, byte-identical prefixes from the
start of verified snapshots through the record establish shared lineage. Matching
text alone is never an identity. Missing session IDs stay snapshot-local. Repeated
identical messages with distinct event IDs, positions or divergent branches remain
distinct. Each hit uses the newest matching capture by import time, with a stable
snapshot-ID tie breaker, and returns `logical_key`, `snapshot_count`, and
`provenance` entries containing original snapshot IDs, import times and citation
URLs. Provenance includes other indexed captures of that event, even when their
text did not match the query. Original snapshots and records are never removed.
Search schema version 3 requires a rebuild of older dialogue indexes; running the
indexing command migrates compatible SQLite files transactionally. Corrupt files
must be removed/rebuilt while no index writer is running.

## Degraded operation

Article-only HTML search never opens the trace index. Catalog browsing without a
query does not search dialogue. Combined/trace HTML searches catch derivative-index
failures and show an availability notice while preserving article results and
original-trace access. `/api/traces/search` returns 503 for corrupt or locked
indexes; absent or incompatible indexes retain the `indexed: false` response.

`/api/articles/health.json` includes independent `articleStorage`, `articleIndex`,
`traceArchive`, and `traceSearch` components. Disabled traces do not degrade health;
a configured missing/incompatible/unreadable trace search index does. Overall health
returns 503 when a configured component is degraded, even if article reads work.
A successful rebuild restores readiness without restarting. Archive health checks
metadata/source-file availability; cryptographic verification happens on cold reads.

The authoritative archive remains recoverable, but archive durability alone does
not prove service correctness or production suitability. These regression fixes
cover receipt identity, degraded availability and snapshot-aware retrieval; they
are not a general production-readiness guarantee.

Search returns at most five inline `provenance` citations per logical event, with an
exact `snapshot_count`, `provenance_url`, and `provenance_nextOffset`. Follow
`/api/traces/provenance.json?key=LOGICAL_KEY&limit=20&offset=0` or call
`wiki.traceProvenance` to read every citation in pages of 1–100. The response includes
`total` citations, `snapshot_count`, `nextOffset`, and an HTTP `next` URL. Provenance
offsets may be any nonnegative safe integer; original source access is unchanged.
Browser search links to `/traces/provenance/?key=LOGICAL_KEY`, with next-page links.
An ordinary SQLite evidence index supports lookup without scanning all FTS rows.

Range spooling enforces the existing 128 MiB archive limit both before opening the
stream and while copying it, including files that grow after the initial stat.
This does not limit the requested line count within an accepted snapshot.
Only a complete stable metadata scan certifies the catalog stamp; overlapping
imports leave it invalid until reconciled, so a concurrent snapshot cannot disappear
from an apparently current index.

A synthetic Linux / Node 26.8.1 check with 1,000 growing snapshots and 40 logical
events returned 200 inline citations in a 70,260-byte JSON response (296 ms for
search). All counts remained 1,000, and paging one event recovered all 1,000
snapshot citations. Timing is a single local observation, not a latency guarantee;
FTS candidate grouping still depends on the number of matching source records.

See [existing archive integration](external-evidence.md) for the optional provider,
its API differences, native conversation URLs, files, and concurrent search.
