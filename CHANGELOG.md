# Changelog

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
