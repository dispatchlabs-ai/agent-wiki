# HTTP API and editing

All JSON routes return `Cache-Control: no-store` and `X-Wiki-Commit` for the current
reader snapshot. URLs are relative to the configured origin.

| Method and path                                     | Result                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/articles/authoring.json`                  | Workflow, access boundary, enabled tools                                                    |
| `GET /api/articles/health.json`                     | `state`, `commit`, article count, index stats, error, write flag; 503 when degraded         |
| `GET /api/articles/catalog.json`                    | Current article summaries and revision IDs                                                  |
| `GET /api/articles/search?q=soil&limit=20&offset=0` | Ranked `articles`, matched `anchor`/`heading`/`snippet`, `total`, `truncated`, `nextOffset` |
| `GET /api/articles/ID/current.json`                 | Markdown `body`, metadata, `revision_id`, commit, numbered revision, backlinks              |
| `GET /api/articles/ID/history.json`                 | First-parent revision list, oldest first                                                    |
| `GET /api/articles/ID/NUMBER.json`                  | Historical article                                                                          |
| `GET /api/articles/ID/COMMIT.json`                  | Historical article at an article-changing commit                                            |
| `POST /api/articles/preview`                        | Sanitized `{ html }` for a Markdown `{ body }` draft; no Git changes                        |
| `POST /api/articles/edits`                          | Coordinated revision-checked commit receipt                                                 |

Search accepts literal terms (prefix matching), quoted phrases, an optional exact
`topic`, `limit` from 1–40, and `offset` from 0–10,000. Queries are at most 300
characters / 30 terms. Results group a bounded 400-section candidate set by article.
`total` counts those article groups; inspect `truncated` before treating it as an
exhaustive count. Empty queries list articles within the same bound. SQL/FTS operators
are not accepted as executable query syntax.

Human views are `/`, `/search/?q=...`, `/wiki/ID/`, `/wiki/ID/history/`,
`/wiki/ID/revision/NUMBER/` (or COMMIT), `/wiki/ID/compare/?from=1&to=2`,
`/wiki/ID/sources/` (optional `?revision=NUMBER`), and `/wiki/ID/edit/`. The form edits an
existing page; create pages through the API, WebMCP, or ordinary Git commits.

Health also reports article storage/index and trace archive/search components.
A configured unavailable trace index degrades overall health without preventing
article-only search or original trace/catalog reads. See [trace health and recovery](traces.md#degraded-operation).

## Regular MCP

For a complete local client setup and a first search/edit workflow, follow
[Connect Codex CLI](getting-started.md#connect-codex-cli).

Connect a Streamable HTTP client to `${WIKI_ORIGIN}/mcp`. The existing wiki
process serves this stateless endpoint; no separate service or browser is needed.
Authenticated installations support [remote OAuth connections](remote-agents.md)
with browser sign-in and agent selection. Unattended operators can also use the
[signing-key adapter](agent-setup.md) for registration and renewal.
Human browser sessions retain their cookie and CSRF flow.
The official MCP SDK handles initialization, discovery, schema validation and
protocol errors. Small tool results contain one text content block with JSON
matching the HTTP API, without a duplicate structured payload. API failures set
MCP `isError` and retain `state`, `status`, `code` and `error` inside that JSON.

The loopback bridge admits at most four simultaneous API calls, with a 30-second
whole-call deadline and a 1 MiB inline JSON budget. A successful GET larger than
that budget returns a short JSON notice (`state: "resource"`, `url`, `message`)
and an MCP `resource_link` to the complete HTTP API result. The bridge stops
reading as soon as the size is known, including chunked responses. It does not
parse or serialize the large body. Follow the URL with the same proxy credentials,
or explicitly request a smaller line range, page or text window. These links use
the ordinary HTTP API, not MCP `resources/read`; no anonymous download route or
separate copy of private content is created. Immutable trace URLs preserve the
selected snapshot/range; mutable queries are evaluated again when fetched.

**Client migration:** accept both inline JSON and `resource_link` results. A
resource notice is not the article/trace payload itself. No source content is
truncated, and direct HTTP/WebMCP reads retain their existing behavior. Oversized
errors and POST responses fail with `MCP_RESPONSE_TOO_LARGE` (503) rather than
returning a misleading GET link. Saturation and deadlines return `MCP_BUSY` and
`MCP_TIMEOUT` (503). Retry an ambiguous save with identical input and operation ID;
closing the MCP connection does not roll back an already committed edit.

MCP and WebMCP use one tool catalog. Discovery reflects the archive provider and
`WIKI_WRITE`; read-only deployments omit `wiki.save`. Trace reads default to
dialogue and accept the same category, time and optional text-window controls.
Calls use the existing loopback HTTP API, including the same writer, revision
checks, atomic updates, evidence verification and retry receipts.

Requests must target the configured Host. A supplied Origin must exactly match
`WIKI_ORIGIN`; native clients may omit Origin. Cross-site browser requests are
rejected and no CORS access is granted. POST bodies are limited to 512,000 bytes. Unsupported methods (including
PUT, PATCH and DELETE) receive 405 before their bodies are read.
Responses carry JSON results (legacy clients may receive SSE framing); the
endpoint does not provide unsolicited notifications or persistent sessions. It enforces the wiki's access boundary. Remote clients use agent bearer tokens.
Human browser-session requests instead require the current wiki session cookie,
exact Origin and session `X-Wiki-CSRF` for POSTs. See
[authentication](authentication.md).
The authoring discovery response includes the endpoint URL and transport.

## Preview a draft

`POST /api/articles/preview` accepts `{ "body": "Markdown" }` and returns
`{ "html": "sanitized HTML" }`. It is read-only and requires the configured Origin
and Host, and JSON content type. The request is limited to 512,000 bytes and the
Markdown body to 100,000 characters. Preview changes no files, revisions, or
receipts.

Draft Markdown is rendered in disposable workers, separate from the HTTP event
loop. At most two previews run and eight wait; the five-second deadline includes
queue time. Each worker has a 128 MiB old-generation heap limit and checks a 2 MiB
rendered-HTML limit before transferring output. Disconnects cancel queued/running
work, and a terminating worker keeps its slot until it exits. These limits also
apply to MCP previews and to read-only instances.

Saturation returns `PREVIEW_BUSY` (503), deadline expiry `PREVIEW_TIMEOUT` (503),
worker failure `PREVIEW_FAILED` (503), and oversized rendered output
`PREVIEW_TOO_LARGE` (413). Simplify the draft after a resource-limit failure;
retry a busy renderer later. The original draft is unchanged. Large POST results
are also subject to MCP's inline budget when preview is called through MCP.

## Save an article

Read the current article first, then supply its exact `revision_id`. For creation,
use `expected_revision_id: null`. One operation may update 1–10 pages atomically,
including mutually linked new pages. Supply all required strings on every update:

```json
{
  "operation_id": "unique-operation-id",
  "updates": [
    {
      "id": "new-page",
      "expected_revision_id": null,
      "title": "New page",
      "description": "A clear summary of this page.",
      "topic": "Examples",
      "body": "A sourced Markdown explanation.",
      "summary": "Create the example article"
    }
  ]
}
```

`operation_id` uses the same lowercase hyphenated syntax as article IDs; a UUID
works. Maximum string lengths: title 200, description 600, topic 100, body 100,000,
summary 1,000. Optional `related` and `questions` arrays replace those fields;
omission preserves them. Optional `evidence` replaces structured source records after verification (see below);
omission preserves them and `[]` explicitly clears them. Other existing frontmatter
is preserved. New pages get
`kind: topic`; use file edits for arbitrary initial custom metadata. Unknown update
fields are not applied. The HTTP body is limited to 512,000 bytes.

Save the JSON in `draft.json` outside the content checkout, then:

```sh
curl --fail-with-body http://127.0.0.1:4317/api/articles/edits \
  -H 'Origin: http://127.0.0.1:4317' \
  -H 'Content-Type: application/json' \
  -H 'X-Wiki-Write: 1' \
  --data-binary @draft.json
```

HTTP writing must be enabled. Requests require the configured Origin, Host,
JSON content type, `X-Wiki-Write: 1`, and same-origin fetch metadata when present.
The browser sends these automatically. The standalone locked writer is also usable:

```sh
WIKI_REPO=/absolute/path/to/content node src/editor.mjs < draft.json
```

A receipt separates three outcomes:

```json
{
  "operation_id": "unique-operation-id",
  "state": "saved",
  "commit": "GIT_COMMIT",
  "articles": [
    {
      "id": "new-page",
      "number": 1,
      "url": "/wiki/new-page/",
      "revision_id": "BLOB_ID"
    }
  ],
  "remote": "not-requested",
  "publication": "live"
}
```

`state` is `saved` or `already-saved`. `remote` is `not-requested`, `pushed`, or
`push-failed`; a failed push does not undo the local commit. `publication` is `live`
or `refresh-failed` and is only returned by HTTP. A successful retry can return an
older receipt while the current article has moved on; read current again before
starting another edit. New durable operation receipts persist each article’s exact
`revision_id`; retries reuse it even after later edits or deletion. Older receipts
without that field resolve their historical numbered revision. Recreation advances
the article’s complete historical lifecycle, including when the new bytes equal
its last pre-deletion revision.

`revision_id` identifies the full Markdown blob, including
metadata, rather than a global repository commit. An update producing identical
Markdown bytes succeeds with the existing article revision. Its operation receipt
is still committed; mixed batches advance only articles whose bytes change.

Retry an ambiguous response with the **same operation ID and identical JSON**.
The committed `.wiki/operations/ID.json` fingerprint prevents duplicate edits and
rejects reuse for different input. Retry also retries a requested push. On a stale
revision, read current content, reconcile the draft and submit a new operation ID;
never substitute the fresh ID blindly. The browser retains drafts in the current
page after failures; it does not persist unsaved drafts across closing/reloading.

HTTP errors: 400 invalid JSON/edit/search, 403 access/origin rejection, 404 absent
article/revision/route, 409 revision/operation/dirty-checkout conflict, 413 oversized
request, 405 unsupported method, 500 unexpected server failure. `error` explains
the failure. Writer failures also return a stable `code`: `INVALID_EDIT` (400),
`REVISION_CONFLICT`, `OPERATION_CONFLICT`, `BRANCH_CONFLICT`, or `WORKTREE_CONFLICT`
(409), and `WRITER_BUSY` or `WRITER_UNAVAILABLE` (503). The CLI emits the same
structured error on stderr with `status`; clients need not classify prose. Unknown
subprocess failures are 503. A failure can follow a durable commit: retain the same
operation ID when retrying. Browser tool schemas and writer string/batch limits
share `public/edit-contract.js`; Git/revision/link checks remain server-side.

## Git correctness and recovery

The writer requires clean `main`, holds an atomic `.git/wiki-write.lock.d` directory lock, writes
through a private Git index, then compare-and-swaps `refs/heads/main`. The commit
contains every changed page and its operation receipt. Only those paths are then
restored to the real index and worktree. It does not commit unrelated files or
force-push. The internal `saveGitEdits` helper assumes its caller owns the lock;
use the CLI or HTTP interface for coordinated writes.

Do not race human or other uncoordinated Git edits against the service writer.
Compare-and-swap protects the branch ref, but cannot preserve a human edit to the
same path made between the clean check and worktree restoration. Pause service
writing for ordinary file edits. A crash after the ref update can leave a dirty
checkout while the complete commit and receipt are already durable. Inspect HEAD,
the receipt and worktree differences, preserve any human changes, and reconcile
the affected paths before further writing. An identical retry can retrieve the
receipt; it does not automatically discard or repair worktree changes.

History is first-parent, by stable basename. Directory moves preserve identity;
renaming a basename creates a new identity. Deletion is a Git operation, not an
editor endpoint; prior revisions remain readable, while current returns 404.
Avoid rewriting content history: revision numbers and receipts depend on it.
The writer does not run Git commit hooks or sign commits (`commit-tree` is used);
repositories requiring those policies need a deliberate integration.

## Writer lock recovery and upgrades

The writer uses Node filesystem operations on local Linux and macOS filesystems;
no extra locking utility is needed. Normal completion and exceptions release the
lock. A writer killed abruptly can leave the directory behind. Other writers wait
up to ten seconds, then fail with its location. Locks are never stolen based on
age or PID, so a delayed writer cannot resume after its lock has been taken away.

After a crash, stop every server and CLI writer for that content checkout. Inspect
HEAD, operation receipts, and working-tree changes as described above. The lock's
`owner.json` records its PID and start time as diagnostic information, not proof
that a process is still alive. Only after all writers are stopped, remove the
`wiki-write.lock.d` directory from the absolute Git directory reported by
`git rev-parse --absolute-git-dir`, then restart. Do not remove live locks.

When upgrading from the original flock-based alpha, stop all old writers first;
the two lock protocols do not coordinate. Shared/network filesystems and writers
on multiple hosts are outside the supported lock model.

Legacy edit receipts without `revision_id` resolve the article blob from the Git
tree at the recorded operation commit. The corresponding historical number is
recovered when available, including article recreation; the legacy numeric lookup
is only a fallback when the article is absent from that tree.

Trace search embeds at most five source citations per event. For complete
provenance, use `GET /api/traces/provenance.json?key=LOGICAL_KEY&limit=20&offset=0`
or WebMCP `wiki.traceProvenance`. Pages contain `provenance`, exact `total` and
`snapshot_count`, `nextOffset`, and a `next` URL. Limits are 1–100; offsets are
nonnegative safe integers. Unavailable or incompatible indexes return 503.

See [existing archive integration](external-evidence.md) for the optional provider,
its API differences, native conversation URLs, files, and concurrent search.

## WebMCP quotation and failure contracts

With `WIKI_EVIDENCE_URL`, `wiki.save` accepts up to 20 `evidence` entries per
article: `{conversation, event, quote}`. Conversations are existing `chat-` IDs;
quotes contain 1–2500 characters and must be exact substrings of recorded dialogue
or tool text. The writer resolves aliases, records canonical event/conversation
IDs, attribution, timestamps and original snapshot/line provenance. Caller-supplied
provenance fields are rejected. The entire batch is verified before committing.
Nonempty structured evidence without the provider fails explicitly; ordinary
Markdown citations and preservation/clearing of existing evidence still work.
The CLI uses the same configured provider and verification path under the writer
lock. Already-committed operation retries do not depend on source availability.

Errors from registered WebMCP callbacks return
`{isError:true, state:"rejected", status, code, error}` instead of throwing away
details at the browser boundary. HTTP status codes remain HTTP statuses. Save
successes retain their existing receipt shape; inspect `remote` and `publication`
separately. `REVISION_CONFLICT` requires a fresh read and reconciliation;
`OPERATION_CONFLICT` rejects different input under an existing operation ID.
`INVALID_EVIDENCE` or `EVIDENCE_MISMATCH` rejects a bad citation without a commit;
`EVIDENCE_UNAVAILABLE` reports a missing/offline provider. Network failures have
status 0 and code `NETWORK_ERROR`; retry an ambiguous save with identical input
and the same operation ID. Native schema-validation errors occur before callbacks.

`wiki.preview({body})` renders sanitized Markdown without saving and is available
on read-only sites. `wiki.file({asset})` is available with an external provider and
reads `GET /api/files/ASSET.json`: `{attachment}` includes availability, metadata,
an optional shortened text preview, and original/download URLs. Binary originals
remain separate streamed media responses, including Range support; tool results
do not inline arbitrary binary files. These actions do not enable article editing.

## Progressive imported-trace reads

`wiki.trace` defaults to original user/assistant text only. It uses
`/api/traces/:id.json?view=conversation`, with `kind=dialogue|tool|reasoning|context`,
optional timezone-qualified ISO `after` (inclusive) and `before` (exclusive), and
`page` (100 selected events per page). Filtering precedes pagination; counts and
`undatedCount` explain what can be expanded. Mixed pi messages expose their text
blocks as dialogue and tool/thinking blocks only in the explicitly requested
category. Source URLs retain original line identities and source-page numbering.
Use `wiki.traceLines` for exact original records. The legacy JSON source-page API
without `view=conversation` and human trace pages retain their original behavior.

## Optional event text windows

Full event text is the default. Supply `textOffset` and/or `textLimit` only when
partial text is useful. These are nonnegative integers measured in Unicode code
points (combining marks count separately). Offset alone returns the remainder;
`textLimit=0` returns length metadata without text. Each message returns
`textWindow: {offset, returnedChars, totalChars, nextTextOffset, unit}` when a
window is requested. Use `nextTextOffset` explicitly to continue, or omit both
parameters to retrieve the full text. An offset at or beyond the end returns an
empty chunk and null continuation. No truncation or summarization is imposed. Supplemental `details` can contain
duplicate full bodies, so text-window responses omit that field and explicitly
report `omittedFields: ["details"]`; an ordinary full read retains it.

Message pagination and time windows still select events; text windows select a
portion of each selected event. For a single event, use `event` (the original wiki
WebMCP tools name it `eventId`). External event aliases resolve to the canonical
event; chunked event lookups return only that event. Imported trace messages have
stable `line-N-part-P` ids to distinguish multiple parts of a mixed source record.
Keep the same event, category and time bounds when continuing. A missing event or
one outside the range returns no chunk. Aggregate analysis is not event text and
does not accept these parameters. Text windows affect message text, not attachment
content; original source records and captured files remain available separately.

Example: `{id, event: "<event-id>", textOffset: 0, textLimit: 4000}` followed by
the same request with `textOffset` set to the returned `nextTextOffset`.

## Authenticated remote clients

For shared hosting, prefer [remote agent connections](remote-agents.md): add the
HTTPS MCP endpoint, sign in, and select an explicitly permitted agent. The signing-key
adapter remains available for unattended operators. The loopback example workflow
uses synthetic content and is not an authenticated hosting configuration.
