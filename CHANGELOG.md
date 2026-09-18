# Changelog

## Unreleased

## 0.8.2 — 2026-09-18

- Return indexed native Claude dialogue from browser, HTTP, MCP and WebMCP trace
  search. The prior server adapters incorrectly replaced valid Claude search
  results with an empty successful response.
- No persisted-data migration or index rebuild is required.
- Add optional section and top-level field selection to current and historical
  article reads across HTTP, MCP, WebMCP and CLI. Outline and metadata reads avoid
  returning article bodies. Selected sections preserve original Markdown and nested
  subsections, with revision identity, stable citations and an explicit partial
  marker. Complete reads remain unchanged and are required before editing.
  No configuration or persisted-data migration is required.

## 0.8.1 — 2026-09-18

- Remove hidden 30-second transport deadlines for CLI trace reads and machine MCP transport. The stdio adapter now allows a one-hour tool request by default, configurable with `requestTimeoutMs`; caller cancellation still applies. Authentication and ordinary metadata requests keep their short deadlines.

## 0.8.0 — 2026-09-18

- Operator enrollment supports explicit maximum credential scopes, allowing trace researchers to read evidence without publishing. MCP reads no longer impose an implicit deadline; cancellation and explicitly configured deadlines remain available.
- Add native Claude Code JSONL snapshots alongside Codex and pi. Claude sources
  need no synthetic header: session identity is discovered from native records,
  UUIDs preserve logical event identity across growing snapshots, and dialogue,
  thinking, tool calls/results and unknown context retain their source fields and
  permanent physical-line citations. Existing archives need no migration; rebuild
  the disposable dialogue index to search newly imported Claude snapshots.

- Remove the fixed trace-read deadline, which rejected complete large snapshots
  on slower storage after their successful import. Full-source integrity checks
  and original-line retrieval can finish regardless of elapsed reading time.
  Worker concurrency, queue and heap bounds remain in place. No data migration.

## 0.7.0 — 2026-09-17

- Remove the imported trace-file byte limit and `WIKI_TRACE_MAX_BYTES` setting.
  Complete snapshots are accepted regardless of their total byte size.
- Stream JSONL import, search indexing and page/disclosure reads without loading
  the complete source into memory. Preserve exact source bytes, branching,
  mirror annotations, search provenance and stable physical-line citations.
- Retain worker resource controls and streamed source-line responses. No persisted
  data migration is needed; remove the obsolete setting from deployment configuration.
- Exercise a snapshot above the former 512 MiB ceiling with a 128 MiB importer/indexer
  heap, including first/last page reads, disclosure, search and source-line access.

## 0.6.3 — 2026-09-17

- Read writer input as a complete asynchronous stream before acquiring the Git
  writer lock. Large or delayed article batches no longer fail with `EAGAIN` on
  nonblocking stdin; revision checks, atomic commits and exact retries remain.
- Add piped UTF-8 and large HTTP batch/retry regressions.
- No configuration or persisted-data migration is required.

## 0.6.2 — 2026-09-17

- Allow operators to configure the imported trace byte limit consistently across
  import, indexing, rendering and source-line reads. The default stays 128 MiB;
  larger immutable snapshots can be served without splitting their evidence.
- No persisted-data migration is required. Keep the setting consistent between
  operator commands and the running service.

- Document the Ubuntu under WSL2 walkthrough and Chromium's system-library
  prerequisites for browser contributors.
- Keep external evidence responses and article metadata separate from internal
  trace-file streaming and cleanup. Preserve authorization and clean up verified
  range files even when access is revoked before the response.
- Cache extracted article citations by Git blob for imported and external
  conversation readers. Reuse unchanged articles and refresh citations after
  committed edits without rebuilding the site.

## 0.6.1 — 2026-09-17

- Fix inline-code contrast in light and dark themes by using the background
  surface color instead of the secondary text color.
- No configuration or persisted-data migration is required.

- Give MCP clients the configured wiki origin and guidance to return complete
  article and source citations, retaining page and line anchors.
- Use MCP's automatic response mode so normal startup no longer warns about
  deliberately dropping notifications.

- Split responsive and rich Markdown browser checks into independent screen-size
  and theme cases, preserving all routes, assertions and review screenshots.
  The contributor command and clean-clone gate now use the same default test
  timeout, without extended timeout overrides.

## 0.6.0 — 2026-09-16

- **Breaking permission change:** readers retain published articles, history and
  citations; original evidence requires editor/manager rights and agent trace
  scope. Source search, previews, files, downloads and delayed provider errors
  enforce the same boundary. Protected media is never publicly cached.
- Add an authenticated HTTP CLI with human password login, browser OAuth, machine
  credentials, search/read/create/edit/history, preview and evidence operations.
  Include structured output, explicit revision/operation IDs, serialized token
  refresh, safe uncertain-refresh handling and credential recovery.
- Publish generated OpenAPI 3.1 and an operation-to-interface inventory. Add
  behavioral parity, evidence-denial, revocation, retry and login regressions.
- Fix bearer access to the external file tool; qualify platform/client boundaries,
  update public setup/security documentation, and remove internal infrastructure
  references from current public guidance.

See [upgrade notes](docs/upgrading.md) before using existing reader credentials.
No persisted article, trace, authentication or receipt format changes.

## 0.5.2 — 2026-09-16

- Add explicitly non-expiring, individually revocable independent machine
  enrollments. Existing expiring keys and delegated authority retain their limits.
- Add a native HTTP MCP credential helper with five-minute tokens and bounded
  runs, eliminating shared OAuth refresh-token rotation for trusted machines.
- Document Codex migration, required startup, credential checks, and revocation;
  test concurrent helpers, years of enrollment, and immediate denial after revocation.

## 0.5.1 — Verified first-use workflows

- Lead with an agent-assisted synthetic quickstart and keep a short manual path.
- Correct personal-content setup: private control database, HTTPS, explicit local
  manager bootstrap and authenticated MCP clients.
- Add an end-to-end production startup/bootstrap/restart regression test.
- Record fresh Linux/macOS agent rehearsals and an unbranded discovery baseline.

## 0.5.0 — Standalone agent authorization

- Remove the shared four-request MCP bridge concurrency limit so concurrent reads
  are no longer rejected with `MCP_BUSY`.

- Keep article contents navigation in normal flow so it cannot overlap related
  articles and backlinks when scrolling.

- Remove the bundled agent-management application and external execution admission.
  Agent identity, grants, signed credentials and revocation are wiki-owned.
- Republish from a fresh public root; prior public history and release tags are retired.
- Agent access is governed solely by wiki permissions and credentials.
  See [the source reset](docs/upgrading.md) for the new public history.

- Rename the project and repository to Agent Wiki (`agent-wiki`). Existing local
  identity issuer values remain stable so accounts and grants keep working.

## 0.4.8

- Sign-in, account setup, password settings and agent consent now share responsive
  UI components, with consistent fields, buttons and clear permission choices.
- Preserve authentication, CSRF, return destinations and consent behavior. No data
  migration is required.

## 0.4.7 — Articles and search components

- Apply shared server-rendered headings, fields, buttons, list styles and metadata
  to Articles and search. Group filters clearly and preserve live search, native
  forms, relevance ranking, citation links and pagination.

## 0.4.6 — shared UI and Conversations pilot

- Introduce shared server-safe controls, fields, badges, headings, timestamps,
  empty states, and pagination. Agents shares the same controls.
- Rebuild Conversations with compact list rows, grouped activity timestamps,
  responsive filters and consistent navigation, preserving request-time rendering.
- Load the Agents interface only on its route.

## 0.4.5 — conversation activity

- Show Last activity alongside Started in the conversation catalog. The archive
  orders browsing by most recent activity, falling back to start for undated ends.
  Search results retain relevance ranking.

## 0.4.4 — conversation start timestamps

- Label conversation catalog dates as Started and show time and timezone in the
  reader’s local timezone, with UTC when JavaScript is unavailable. These are
  source start timestamps, not ingestion times.

## 0.4.3 — header theme control

- Move the theme menu to the top-right header, beside the account menu when
  signed in. Keep it visible on signed-out pages and adapt narrow phone headers.

## 0.4.2 — theme mode toggle

- Replace the footer select with an accessible shadcn/Base UI icon menu for Light,
  Dark and System. Default to System, follow device changes, preserve saved
  preferences, and keep the control available while signed out.

## 0.4.1 — signed-out navigation

- Hide unavailable navigation, search, account controls and the Agent API link on
  sign-in and account-setup pages. Keep branding and appearance controls available.
  Authenticated pages and the synthetic example retain their full navigation.

## 0.4.0 — authenticated hosting and remote agents

Breaking change: the standalone server now requires an authoritative control
database, HTTPS hosting configuration, and explicit human/agent grants. Existing
anonymous hosted clients must migrate using [authentication](docs/authentication.md)
and [remote connections](docs/remote-agents.md). Synthetic loopback examples remain
available. Back up control state as well as content before upgrading.

- Restrict human-directory discovery to current wiki members with agent access
  management permission; preserve explicitly granted agent-only invocation.
- Add portable clean-clone checks for local CI and clarify credential recovery.

### Remote user-to-agent connections

- Rebuild the Agents page with shadcn/Base UI dialogs, buttons and tabs, responsive
  cards, clear permission controls, and a separate client-connections view.

- Connect remote MCP clients with browser sign-in, agent selection, S256 PKCE,
  public client registration and rotating, revocable OAuth credentials.
- Manage named agents, definitions, invoke/configure/access grants and client
  connections through the Agents page. Preserve actual human initiator and agent
  actor attribution, with current permission checks at access and publication.
- Existing operator signing-key adapters remain supported.

### Authenticated hosting

- Add a Pi extension for normal-session Wiki MCP tools and instructions, with
  opt-in synthetic model acceptance; document native Claude user setup.

- Document Claude subscription login and add an opt-in synthetic Claude Code
  acceptance probe for wiki search, trace reads, writes, and run closure.

- Add named agent registration, independent/delegated run authority, registered
  public-key authentication, five-minute tokens, and a renewing stdio MCP adapter.
  Operator commands generate runtime files, enroll public keys, and revoke access.
  Agent writes preserve run-bound receipts and recheck authority before publication.
  This is the current single-space integration; the multi-space roadmap is unchanged.

- Offer sign-in on protected browser links and return to the requested page and
  citation anchor after Google/OIDC or local login. API and embedded-media requests
  remain authenticated and return 401 without credentials.

- Align footer links and appearance controls on phones, and size short pages
  to the available viewport without a fixed content spacer.

- Integrate identity and account actions into an accessible header menu; keep
  search and account controls together with compact mobile navigation.

- Direct Google OIDC and independent local accounts with invitation setup,
  explicit reader/editor/manager grants, secure sessions and operator recovery.
- Authenticated articles, original evidence, media and MCP; aliases redirect to a
  canonical cookie origin. Current rich-reader and original-source behavior remain.
- This development integration is not a published release.

## 0.3.3 — 2026-09-12

- Use shared React components for the server-rendered header, navigation, footer,
  feed cards and date filters. Share the search form between header fallback,
  dialog and results page; content continues to render on demand without a build.
- Rename navigation to Articles and Conversations, clarify the Search trigger,
  and simplify the mobile home page to one heading with smaller feed titles.
- Show bounded article descriptions in the feed instead of internal edit summaries;
  titles open articles and View changes retains access to revision comparisons.
  Original summaries remain in history. No content or API migration is required.

## 0.3.2 — 2026-09-12

- Simplify the identity to an open book in the same upright orientation, removing
  the letter cutouts from the header, favicon, and all standalone SVG variants.
  Responsive spacing and appearance behavior are unchanged. No migration required.

## 0.3.1 — 2026-09-12

- Add a clean vector book/monogram, compact responsive header branding, and a
  favicon. The header follows light, dark, and forced-color appearance.
- Supply transparent light, dark, and monochrome logo assets with editable
  lettering and reproducible vector geometry. No content migration is required.

## 0.3.0 — 2026-09-12

- Add shadcn Typeset, a Base UI search dialog and content tabs, and a consistent
  responsive reader/editor surface from 320px phones to 2560px desktops.
- Render alerts, highlighted code with copying, native MathML, isolated Mermaid
  diagrams, and named tabs, figures and disclosures through the shared renderer.
- Namespace conversation footnotes while preserving original event/source-line
  citations, article anchors, captured media, revision checks and edit receipts.
- Preserve server-side, on-demand Markdown and JSONL rendering. Content commits
  need no rebuild or redeployment; browser assets build once during `npm ci`.
- **Upgrade:** users of `npm ci --ignore-scripts` must run `npm run build:ui`.
  Search indexes rebuild automatically for the richer parser. Review literal
  dollar signs and directive fences now interpreted by the Markdown profile.
  No content or trace migration is required.
- This minor pre-1.0 release also includes the previously unreleased MCP response
  migration below. Clients must support resource-link results for large reads.

- Reuse compiled MCP tool schemas across requests to prevent SDK cache growth.
- Reject unsupported MCP methods before reading their bodies, preserving the
  request-size boundary and promptly rejecting unfinished uploads.

- Isolate draft previews in a bounded worker pool with queue-inclusive deadlines,
  worker heap/output limits, and cancellation on disconnect. Article serving stays
  responsive during expensive previews, including on read-only instances.
- Propagate MCP call cancellation and disconnects to loopback requests so abandoned
  calls release admission slots and preview workers promptly. Cancelling a save
  cannot undo a commit; retry with identical input and operation ID.
- Bound MCP loopback concurrency, response buffering and request duration. Large
  successful reads return a resource link to complete HTTP JSON; originals remain
  available without truncation. Errors and writes never become GET resource links.
- **Client migration:** MCP callers must handle resource-link results as well as
  inline JSON. The notice includes the complete-result URL; fetch it using the same
  access credentials or explicitly request a smaller range. See `docs/api.md`.

- Isolate example startup from ambient external-evidence configuration; exercise
  startup, saving, and restart without contacting an operator’s provider or pushing.
- Add a visual introduction and a clone-to-agent walkthrough, including a personal
  content repository, troubleshooting, and explicit client compatibility evidence.
- Add a scoped contributor roadmap and release signature verification instructions;
  align security reporting with the repository’s enabled private reporting channel.

## 0.2.3 — 2026-09-11

- Fix oversized conversation headings and duplicate Codex attachment wrappers.
- Show matched attachments once, retaining original recorded text in expandable
  source details. Unknown wrappers and code examples remain literal.
- Preserve API text, source records, citations, and captured files; no migration.

## 0.2.2 — 2026-09-11

- Serve regular MCP over Streamable HTTP at `/mcp` in the existing wiki process.
- Share tool schemas and operations with WebMCP, including progressive trace
  disclosure, provider-specific discovery, structured errors and write safeguards.
- Validate Host, browser Origin and request size; preserve read-only defaults.
- Verify discovery, reads, previews, save retries, conflicts and external trace
  windows through an official MCP client against synthetic repositories.

## 0.2.1 — 2026-09-11

- Added optional `textOffset`/`textLimit` trace text windows. Full selected event
  text remains the default; no automatic cap or summarization is introduced.
- Window responses report total Unicode character length and continuation offsets.
  Zero-length requests inspect size; chunks preserve exact original text.
- Cited external event chunks exclude neighboring bodies. Imported messages expose
  stable per-record-part event ids for targeted reads, including mixed pi records.
- External providers must support the optional text-window parameters before
  clients use them. Existing requests and original source access remain unchanged.

## 0.2.0 — 2026-09-11

- Trace tools now disclose user prompts and assistant responses first. Tool calls,
  outputs, recorded reasoning and context require explicit follow-up requests.
- Added timezone-aware `after`/`before` ranges, applied before pagination, with
  inclusive/exclusive boundaries and undated-event counts. Source identities and
  original event text remain intact.
- External trace API attachments default to metadata; `wiki.file` and explicit
  `attachments=preview` requests expand content. Human previews remain embedded.
- **Migration:** imported `wiki.trace` now returns `messages` containing selected
  text and source links instead of raw `records`. Use `wiki.traceLines` to retrieve
  exact source records, or the existing source-page HTTP API without
  `view=conversation`. External providers must implement the updated range and
  attachment contract in `docs/external-evidence.md` before upgrading.

## 0.1.2 — 2026-09-11

Compatible WebMCP fixes and additions; no content migration or automatic writer activation.

- Translate external trace page numbers to offsets, validate pagination conflicts,
  and omit unsupported imported-session filters from external tool discovery.
- Preserve structured HTTP errors through native WebMCP, including writer errors
  accompanied by runtime warnings. Success receipts retain their existing shape.
- Add read-only Markdown preview and captured-file inspection tools, including
  preview status and original/download URLs.
- Accept verified structured quotations in article edits. Exact dialogue/tool
  quotes resolve original event aliases and retain provenance; omitted evidence
  is preserved and an empty array explicitly clears it. Receipt retries work even
  when the evidence service is unavailable.
- Exercise real Chromium WebMCP registration and execution in synthetic browser
  tests, including pagination, file ranges, atomic quote rejection and save retries.

## 0.1.1 — 2026-09-10

Compatible additions and fixes; existing imported archives continue to work.
External archive integration is opt-in and does not migrate original evidence.

- Add independent, concurrent article and trace search with scope and metadata filters.
- Add a read-only external evidence provider, native conversation pages, preserved
  event aliases and category navigation, captured images and file previews/downloads.
- Preserve structured evidence records and article source anchors; render raw HTML
  as literal text and avoid automatic external image requests.
- Add desktop/mobile coverage for delayed trace results, event navigation and files.

- Recover legacy recreation receipts from their recorded Git tree before numeric fallback.
- Enforce the existing archive size limit throughout verified range spooling.
- Bound inline search provenance and expose complete paginated citations in HTTP,
  WebMCP, and the browser. Search schema 3 requires an index rebuild.
- Reconcile metadata after overlapping imports instead of certifying partial updates.

### Fixed

- Restore the approved desktop proportions and editorial typography, tighten mobile
  spacing, separate Edit from reading tabs, and distinguish sidebar navigation groups.
- Enrich the synthetic articles with linked decisions, source citations, related
  articles and an open review question. Existing content is never silently reseeded.

- Recreated articles advance their complete revision lifecycle. New durable receipts
  persist blob IDs; retries preserve those IDs, with fallback for older receipts.
- Failed trace-search indexes no longer take down article-only search or catalog
  browsing. Combined HTML search degrades visibly and health reports components.
- Growing captures group by logical event in search, preserving distinct repeated
  dialogue and branches, with newest matching representatives and provenance.

### Changed

- Explicit range responses are verified and disk-spooled, streamed with backpressure,
  and excluded from the rendered cache. Workers calculate page-cache byte sizes.
- Catalog pages use an independently rebuildable metadata index.
- Source JavaScript/JSDoc boundary checking is part of `npm run check`.
- Serving benchmarks include large snapshot catalogs and OS peak RSS.

### Added

- Session grouping in the trace catalog, with paginated session/snapshot APIs and
  a `wiki.traceSessions` tool. Original snapshot URLs remain unchanged.
- Caller-selected original source-line reads through HTTP and `wiki.traceLines`, retaining
  blank lines and stable citations without rendering HTML. Cold reads stream the
  full source for integrity verification. Line ranges and complete records have no
  added line-count or response-byte cap; agent harnesses manage their own context.

## 0.1.0 — 2026-09-10

Completes the 0.1.0-alpha.1 preview. This is an initial-development source release.
No breaking changes or content migration are required from that preview.

### Added

- Linux and macOS support with portable writer locking.
- Rebuildable trace dialogue search with bounded results, source-line citations,
  and the `wiki.traceSearch` WebMCP tool.
- End-to-end serving benchmarks, contributor contracts and compatibility guidance.
- Linux/macOS runtime CI and a Chromium editor test.
- An explicit SemVer policy and versioned release checklist.

### Fixed

- Unchanged saves retain the actual article revision in durable retry receipts,
  including mixed batches and retries after subsequent edits.
- Reference-style Markdown links participate in validation and backlinks.
- Impossible trace pages are rejected before parsing the complete snapshot.

### Changed

- Shared edit contracts and structured writer errors; trace interpretation is
  separated from presentation without changing projected records.

### Known limitations

- Trace attachment playback and parent-session stitching remain unsupported.
- No built-in user authentication, ingestion pipeline, or multi-tenant permissions.
- Git and SQLite operations remain synchronous; benchmark results are workload-specific.

## 0.1.0-alpha.1 — 2026-09-09

Initial MIT-licensed public source alpha with synthetic examples: Git-backed
Markdown articles, incremental SQLite search and backlinks, revision-checked
editing and retry receipts, native WebMCP, and on-demand Codex/pi JSONL traces.
