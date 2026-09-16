# Architecture implementation milestones

Status: milestone 1 implemented with direct Google and local login; live Google verification outstanding, September 12, 2026. Implements the [architecture](architecture.md)
and [space/access model](spaces-and-access-control.md). See [authentication](authentication.md) for the implemented single-space foundation and verification limits. Milestones 2–7 remain planned. Prepared with AI assistance.

## Delivery rules

Work directly against the new design. There is no migration or backward-compatibility
workstream: replace old schemas, endpoints, and configuration as needed. Preserve
original articles and traces, use synthetic fixtures for development, and keep
operator recovery distinct from migration machinery.

Each milestone delivers one complete path through storage, authorization, APIs,
and UI where applicable. Do not create a separate microservice for each module.
Keep existing Git correctness, sanitization, trace fidelity, resource bounds, and
idempotency behavior unless this design explicitly changes the contract.

`npm run check` remains the baseline. Browser-facing changes also run
`npm run test:browser`; use real browser interactions for identity selection,
sharing, search, and edits. Test mocks validate policy logic, not real OIDC or
external workload integration. Record an actual selected-provider integration
before calling authentication ready. Update README, API contracts, examples, and
operator documentation with each implemented capability.

## 1. Authenticated single-space foundation

**Depends on:** the architecture decisions in this repository.

Introduce the durable control store, principal/organization/group/space records,
space grants, request authentication, and centralized policy checks. Wrap existing
single-repository services before adding multi-repository composition. Route all
article and trace reads, search, history, writes, authoring metadata, and health
through authorization. Remove unauthenticated content exposure and the global
commit header. Preserve static asset delivery and non-sensitive liveness checks.

Select one human OIDC provider and a maintained library; document callback/origin,
session, CSRF, logout, bootstrap, and issuer/subject mapping behavior. Add an explicit
local first-admin setup and a synthetic development identity fixture. Production
must not accept development identity headers or a caller-selected user.

**Acceptance:**

- Two users with different space grants produce different authorized outcomes on
  every route, including raw traces, history, cached responses, and metadata.
- Unknown and inaccessible resource IDs are indistinguishable to unauthorized users.
- Manager can grant/revoke access; editor cannot alter grants or identity through
  Markdown, edit payloads, or a forged header.
- Current membership is checked after revocation, including an in-flight async trace
  read. Control-store failure denies content access.
- A real OIDC round trip establishes a session for the intended external identity;
  wrong issuer/audience, expired sessions, and forged callbacks fail.
- The synthetic example remains straightforward to run without live company data.

**Primary code:** `server.mjs`, new `authn.mjs`, `authorization.mjs`,
`control-store.mjs`, service wrappers, `public/client.js`, HTTP/browser tests.

## 2. Spaces, ownership, and cross-company grants

**Depends on:** milestone 1.

Introduce the space registry and per-space reader/index lifecycle. Implement personal
spaces, organization spaces, typed group membership, Everybody, external principal
grants, space sharing UI, and explicit space selection. Multiple organizations share
one installation and identity directory; no cross-installation federation is needed.
Use a bounded refresh queue and isolate degraded spaces.

**Acceptance:**

- A user sees My space and group/shared spaces, including an explicitly shared
  external space, without receiving organization membership implicitly.
- Everybody grants apply only to active human members of the named organization.
  New agents and guests do not automatically join it.
- A grant to another organization's group tracks that group's membership; removing
  the grant revokes access independently of the external identity lifecycle.
- Provisioning a space either yields a usable registered repository or a recorded,
  recoverable failure. Client-controlled paths/remotes are rejected.
- A broken repository does not stop authorized reads in other healthy spaces.
- No agent or ordinary user receives filesystem or Git credentials.

**Primary code:** new `space-registry.mjs`, control store, per-space constructors,
sharing UI, provisioning command, synthetic two-organization fixtures.

## 3. Stable article identity, graph, and search

**Depends on:** milestone 2.

Replace basename identity with immutable article IDs; update Markdown references,
URL construction, link picker, history references, and location generations.
Separate link resolution from Git tree validation. Query authorized space indexes
and merge results deterministically. Filter backlinks, previews, counts, facets,
and location responses. Keep article and trace result types distinct in the UI.

**Acceptance:**

- Same filename in different spaces does not collide; duplicate live article IDs
  are rejected. Filename changes do not change identity.
- A restricted or missing cross-space link neither breaks the source article nor
  exposes target metadata. Explicit source labels remain ordinary article text.
- Search results and pagination are computed only from authorized spaces. Adding
  an inaccessible space does not alter returned counts, snippets, or ranking.
- Revocation invalidates pagination context; cached HTML does not retain old
  backlinks, titles, or navigation for the next user.
- Historical reads authorize the owning historical space and retain exact commit/
  blob references. Readers cannot enumerate foreign repository history.
- Synthetic larger corpora establish a baseline for refresh and federated local
  search latency; record measured results rather than inventing a target from the
  earlier single-index benchmark.

**Primary code:** `git-wiki.mjs`, `wiki.mjs`, `markdown-structure.mjs`,
`wiki-search.mjs`, `render.mjs`, new search/article services, shared API schemas.

## 4. Authorized writes and durable operation recovery

**Depends on:** milestones 1–3.

Integrate the writer with the mutation coordinator and trusted attribution envelope.
Serialize final publication against grant changes. Preserve per-space atomic batches,
revision checks, private-index commits, clean-worktree rules, compare-and-swap,
idempotency, and push/publication status. Journal the SQL/Git boundary and reconcile
unfinished operations on restart. Keep raw operator maintenance explicitly separate.

**Acceptance:**

- Batches across spaces are rejected; one-space batches remain all-or-nothing.
- Stale blob revisions or location generations fail rather than overwriting newer
  content or writing into an unintended space.
- A queued write loses authorization if revocation is ordered first. A committed
  write followed by revocation remains committed and correctly attributed.
- Crash before Git commit, after commit, and before audit completion yields no
  duplicate edits and a reconstructable final receipt.
- Reusing an operation ID with changed content, actor, or authority context cannot
  retrieve another principal's result or bypass current authorization.
- Failed push is distinguishable from failed save; retry does not duplicate content.
- An authorized ordinary edit requires no additional publication approval merely
  because the author is an agent or consulted restricted sources.

**Primary code:** `editor.mjs`, new mutation coordinator, control journal,
article service, `public/edit-contract.js`, writer/HTTP integration tests.

## 5. Agent principals, runs, and authority

A focused [single-space agent setup](agent-setup.md) now implements registration,
key-based runtime authentication, explicit authority, and a stdio client adapter.
This does not mark this multi-space milestone or its prerequisites complete.

**Depends on:** milestones 1–4.

Implement agent registration, ownership, definition versions, invoke/configure/
manage-access grants, direct/group space grants, delegation records, and runs.
Integrate one trusted runtime or broker using scoped, short-lived wiki credentials.
Fix delegated versus own authority for each run. Do not build a model runner or
agent scheduler inside the wiki to demonstrate this contract.

Use a synthetic agent client for repeatable tests and one real runtime integration
for verification. Select the credential adapter at this milestone using the chosen
runtime's supported identity mechanism. Do not expose signing keys to the model.

**Acceptance:**

- A delegated assistant uses the permitted subset of the user's current rights
  without permanent duplicate space grants.
- An independent worker can perform its granted operation for an authorized invoker
  who lacks direct source access; invocation does not expose the complete raw trace.
- A delegated denial never retries under the agent's standing rights.
- Forged actor, run, subject, expiry, or task scope fails; tokens are rejected at
  the wrong audience and after local run/delegation suspension.
- A schedule can trigger a durable delegated run or an independent run without
  confusing the two authorization bases.
- Agent configuration is separately controlled and versioned; owner transfer and
  suspension work without deleting historical attribution.
- An external agent can receive and lose a local space grant without being made
  a member of the owning organization.
- Requests and receipts retain both actor and delegated subject where applicable.
  New task IDs cannot be used to smuggle a broader credential context.

**Primary code:** agent/run services, auth adapter, control store, management UI,
service contract tests, broker integration fixture.

## 6. Comprehensive trace capture and search

**Depends on:** milestones 2–5. Existing trace reads remain protected from milestone 1.

Expose authenticated trace ingestion with an explicit destination and trusted
provenance binding. Retain byte-for-byte snapshots and source-line citations.
Track session snapshots and durable ingestion/indexing progress. Add all-record
text search alongside default dialogue search; preserve bounded workers and queues.
The collector adapter delivers snapshots and retries; the wiki does not scan
operators' machines implicitly.

**Acceptance:**

- All original record types, unknown fields, branches, and tool results survive
  capture and can be retrieved exactly. Growing-session snapshots remain distinct.
- Dialogue and all-record search make their coverage clear. Tool output can be
  found in all-record mode with exact source references; encrypted/binary content
  is not falsely described as searchable plaintext.
- Duplicate import is idempotent. Same bytes in two spaces do not merge their
  access grants or disclose the other association.
- Imports require destination rights; runtime-bound run attribution cannot be
  replaced by JSON fields inside an untrusted source trace.
- Personal and independent-worker trace defaults are restricted. Shared capture
  explicitly chooses its audience; raw trace readership is independent of article
  readership and invocation rights.
- Queue saturation, malformed records, interrupted ingestion, and index failure
  are observable and recoverable without modifying original evidence.
- Credential material controlled by the integration never enters captured output;
  original third-party traces are not silently rewritten to disguise their contents.

**Primary code:** `traces.mjs`, `trace-worker.mjs`, `trace-search.mjs`, import/index
scripts, trace service, collector contract, synthetic format fixtures.

## 7. Space lifecycle, moves, and operational completion

**Depends on:** milestones 1–6.

Implement space archival, responsible-owner transfer, journaled cross-space moves,
consistent backup/restore, and audit inspection. Move only the current article,
retain old history under the source space, and activate the new location only when
the operation is complete and authorized. No automatic hard deletion is needed for
the initial release.

**Acceptance:**

- A move preserves article identity, source history restrictions, and incoming
  links while transferring the current version to its new audience.
- Destination copies remain hidden before activation, including direct history
  and search access. A revoked move cannot activate automatically.
- Failure injection at every move phase yields a recoverable journal state with
  no missing original bytes, duplicate active identities, or premature disclosure.
- A consistent backup restores grants, article locations, repositories, traces,
  and audit context; indexes can be rebuilt separately.
- Documentation identifies authoritative files and operator-only access. End-to-end
  browser/API checks cover two organizations, humans, both agent modes, sharing,
  ordinary edits, trace search, and revocation.

**Primary code:** move/lifecycle coordinator, registry, recovery commands,
backup/restore tooling, acceptance tests and operator documentation.

## Ready-to-start boundary

Begin with milestone 1. Provider selection is part of that work, not a reason to
build abstractions for every provider first. The initial policies chosen in the
architecture—human-only automatic Everybody membership, no nested groups or
subdelegation, same-installation external sharing—are explicit defaults that can
change through ordinary follow-up development.

Do not add migration tooling, a compatibility API, a distributed permission engine,
a separate repository-serving process per space, or automatic source-permission
inheritance for articles. Expand those architectural choices only in response to
an actual requirement; the phased plan already delivers the agreed product model.
