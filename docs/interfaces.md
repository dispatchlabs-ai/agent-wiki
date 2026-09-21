# Operations, interfaces and authority

The supported application is one hosted wiki with a single content space. All
ordinary interfaces call the HTTP service and its shared Git writer. Markdown in
Git, immutable source evidence and the control database are authoritative; search
indexes and render caches are derived. No model provider or external agent manager
is required. Multi-space composition remains a proposal in architecture.md.

## Permission contract

| Operation                                                                                                                             | Human space grant                       | Agent run scope, in addition to current grant                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Published article search/read/catalog/history, citations, unsaved Markdown preview                                                    | Reader, editor or manager               | `wiki:read`                                                         |
| Deliberately published article images and PDFs                                                                                        | Reader, editor or manager               | `wiki:read`                                                         |
| Original conversations, dialogue snippets, catalogs, provenance, source lines, attachment metadata/previews, original bytes/downloads | Editor or manager                       | `wiki:trace`                                                        |
| Article create/edit/batch save                                                                                                        | Editor or manager, with `WIKI_WRITE=1`  | `wiki:write`; verifying supplied quotations also needs `wiki:trace` |
| Space grants and account invitations                                                                                                  | Human manager                           | Deliberately excluded from bearer credentials                       |
| Agent definition and invocation permissions                                                                                           | Explicit human permission on that agent | Deliberately excluded from bearer credentials                       |

Evidence permission is independent of enabling writes: an editor on a read-only
server can retrieve evidence. An agent with read/write scope alone can edit articles
but cannot query original evidence or verify new quotations. Delegated runs must
retain the human subject's current matching authority too.

Published article Markdown, metadata, history, authored citation labels and selected
quotations remain article content. Access control does not redact text an editor
has deliberately published. Raw source content is retrieved separately. Ordinary
readers receive article-only search/health and no evidence tools in discovery.
Unauthorized and nonexistent evidence both return concealed 404s, before lookup.
Responses recheck authority after asynchronous reads, including upstream errors.
Media/ranges/downloads are `no-store`. Revocation cannot recall bytes a caller
already received while authorized.

## Operation-to-interface inventory

`src/api-contract.mjs` records each tool operation, permission, HTTP path, schema
and CLI command. It generates [OpenAPI 3.1](openapi.json), also served publicly at
`GET /api/openapi.json`. The API contract version follows the source version;
`npm run contract` regenerates it and `npm run check` rejects drift. Runtime
response and cross-interface tests complement schema checks.

| Shared operation                                         | Web UI                                            | HTTP                                 | MCP / WebMCP                                                          | CLI                                                           |
| -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Article search/read/history                              | Supported                                         | `/api/articles/…`                    | `wiki.search/read/history`                                            | `search/read/history`                                         |
| Create/update atomic article batch                       | Existing-article editor; creation through tools   | `/api/articles/edits`                | `wiki.save`                                                           | `create/edit/save`                                            |
| Unsaved Markdown preview                                 | Editor                                            | `/api/articles/preview`              | `wiki.preview`                                                        | `preview`                                                     |
| Evidence search/catalog/read                             | Search and conversation reader                    | `/api/traces/…`                      | `wiki.traceSearch/traces/trace`                                       | `trace-search/traces/trace`                                   |
| Imported provenance/session groups/original lines        | Reader provenance links; full range through tools | `/api/traces/…`                      | `wiki.traceProvenance/traceSessions/traceLines`                       | Matching `trace-*` commands                                   |
| External captured file metadata/preview                  | File reader                                       | `/api/files/…`                       | `wiki.file`                                                           | `file`                                                        |
| Original media/download/range                            | Protected links                                   | `/media/…`, protected evidence proxy | Protected result links; binary output intentionally excluded          | Protected result URL; disk download intentionally excluded    |
| Published article image/PDF bytes and ranges             | Article links                                     | `/article-media/…`                   | Protected result links; binary output intentionally excluded          | URL returned inside article Markdown                          |
| Article catalog/health/authoring and contract            | Catalog, discovery                                | Dedicated JSON routes                | Tool discovery; standalone health/catalog tools deliberately excluded | `catalog/health/contract`; authoring used internally          |
| Human local login/logout                                 | Supported                                         | Existing session endpoints           | Browser/transport credentials                                         | `login --email … --password-stdin`, `logout`                  |
| Browser OAuth, selecting an agent                        | Consent and connections                           | OAuth/metadata routes                | Remote OAuth clients                                                  | `login --url …`, `logout`                                     |
| Machine enrollment/login/run close                       | Enrollment is operator-owned                      | Token/run endpoints                  | Signing-key adapter                                                   | `login --connection …`; commands close their run              |
| Human account/grant/agent administration                 | Supported                                         | Human-session APIs                   | Deliberately excluded from machine tools                              | Local `whoami`; administration intentionally stays in UI/HTTP |
| Bootstrap, import/index archives, direct Git maintenance | Operator-only                                     | Deliberately excluded                | Deliberately excluded                                                 | Separate existing operator scripts; filesystem authority      |

`call wiki.TOOL --file arguments.json` covers each discovered content tool's full
argument set when a short CLI command exposes fewer options. Imported and external
archives have different IDs, paging and available tools; they are alternative
configured providers, not interchangeable payload formats. The protected raw
`/api/evidence/v1/…` passthrough preserves the operator-selected provider's contract;
arbitrary provider extensions are outside the engine's fixed schema guarantees.

No interface needed for the supported article/evidence workflows is deferred.
Multi-space tenancy, hosted model execution, package distribution, arbitrary
third-party connector onboarding and direct-storage remote administration are
outside the current release. Missing capabilities must be classified explicitly
when adding a supported workflow; this inventory is not a blanket promise of UI
controls for every scripting operation.

## Identity, retries and intentional transport differences

Local browser and password CLI sessions act as the same human. Browser OAuth
selects an explicitly invokable agent and records the human initiator; the CLI
does not silently switch from human to agent authority. Machine keys identify an
enrolled agent. Compare clients only with the same actor, authority and scope.
Operator filesystem access is a separate authority boundary.

All saves use current revision checks, atomic batches, attributed commits and
actor/authority-bound operation receipts. Reusing identical input recovers one
commit across interfaces; new input with an existing operation ID conflicts.
A revoked caller cannot recover a private receipt. Commit, push and reader
publication are reported separately. No client may infer rollback from a lost
response. Browser OAuth refresh is rotating; an uncertain exchange needs a new
login, not a replay of the old refresh token.

HTTP errors include a stable `code` and `error`; adapters retain them. MCP/WebMCP
wrap operation errors in `isError` results. Unavailable tools are omitted from
discovery and an attempted call may receive a protocol-level unknown-tool error.
MCP schema validation can reject a malformed argument before HTTP execution;
HTTP is authoritative for permission, revision and write validation. Large MCP
reads return a protected resource link after its 1 MiB inline budget; direct HTTP
and WebMCP retain full output. The CLI intentionally exposes the server payload
as JSON rather than truncating it.

## Verification and compatibility

`tests/interface-parity.test.mjs` exercises real CLI processes, local human login,
browser OAuth through a synthetic approval callback, refresh/uncertain-refresh
recovery, identical HTTP/MCP/WebMCP results, attributed writes, lost-response
retries, conflicting revisions, role changes and revocation. Agent-auth tests
cover full versus narrowed evidence scope, machine renewal and independent runs.
Authenticated HTTP tests cover evidence search, previews, original records,
media/downloads, delayed success/error revocation and no archive contact on denial.
Browser tests exercise actual sign-in, grants, editing and reader behavior.

Native WebMCP remains browser-dependent; SDK/schema tests alone do not establish
support in every browser. Named client evidence and its limits remain in
[agent setup](agent-setup.md) and [onboarding verification](onboarding-verification.md).
The ordinary CLI runs on the same supported Node/Linux/macOS baseline and needs
network access to its wiki. Private deployment is not a prerequisite for checks.
