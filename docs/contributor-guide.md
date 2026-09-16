# Contributor map

New here? Start with the [walkthrough](getting-started.md) and pick a scoped issue
from the [roadmap](roadmap.md). The contracts below describe sensitive internals;
they are review criteria, not a list of beginner tasks.

The engine owns serving, indexing, and revision-checked editing. Content and trace
collection belong to the operator. Keep original Markdown/Git and JSONL recoverable;
never introduce a second authoritative conversation representation.

## Where to change behavior

- Git history and publication: `src/git-wiki.mjs`; write coordination:
  `src/editor.mjs`. No-op saves retain article revisions; receipts remain durable.
- Markdown syntax and anchors: `src/markdown-structure.mjs` and `src/wiki.mjs`.
  Rendering, link validation, and search must agree on supported syntax.
- Browser/HTTP edit shapes: `public/edit-contract.js`. The writer owns validation;
  `src/errors.mjs` defines failures that cross the subprocess boundary.
- Trace interpretation: pure `src/trace-format.mjs`; presentation:
  `src/trace-worker.mjs`; derived dialogue search: `src/trace-search.mjs`.

## Compatibility and fixtures

Linux and macOS are supported through the portable directory writer lock. Node
24.19.0 is the tested minimum for the built-in SQLite implementation. CI runs the
core suite on both platforms with 24.19.0 and 26.6.0; an engines lower bound is not proof that every
intervening or future runtime works. Chromium exercises the actual editor and
module loading. `tests/browser/webmcp.spec.mjs` enables experimental web-platform features in the
pinned Chromium and exercises native `document.modelContext` registration and
execution with synthetic content. It tests read and write flows without a mock
registration shim. Other browsers and agent-host integrations need their own
compatibility checks.

`examples/traces/codex.jsonl` and `pi.jsonl` are synthetic baseline fixtures.
`tests/traces.test.mjs` adds typed/paginated Codex history, repeated representations,
pi branches/revisions, corruption and pagination. This is a tested shape inventory,
not a claim of support for every harness release. For a newly supported variant,
include a minimal synthetic record sequence, identify the harness version/shape in
the test, and assert original record values, dialogue classification and citation
lines. Never paste a real rollout into a fixture. Unknown records remain inspectable
context; change `TRACE_VERSION` when projection or index interpretation changes.

## Core contracts for behavior changes

1. **Receipt correctness.** Preserve blob IDs and lifecycle numbering across edits,
   deletion/recreation and retries; include an end-to-end regression for any change.
2. **Degraded operation.** Keep independent components usable when a derivative
   fails, expose component health, and prove recovery after rebuilding.
3. **Search grouping.** Preserve native identity and verified lineage; never merge
   repeated dialogue solely by text. Test branches, revisions and pagination.
4. **Resource bounds.** Measure cold-page work, spool disk use, large catalogs and
   OS peak RSS. Preserve full explicit reads and integrity checks; the harness owns
   context management. Avoid unverified data reaching a response.
5. **Additional format support.** Add one documented synthetic format variant at
   a time using the fixture rules above.

`npm run typecheck` checks JavaScript/JSDoc across `src/` and the shared edit
contract. `src/contracts.mjs` describes revision, trace metadata, search and worker
boundaries. Newly persisted receipts require `revision_id`; legacy receipt shapes
remain separately represented. Compile-time regression fixtures prevent accidentally
making required fields optional. This is incremental boundary checking, not a claim
that every arbitrary upstream payload has a fully closed schema.

Discuss interface changes before implementation. Keep a contribution focused on one
behavior, run `npm run check`, and include the specific regression or benchmark
result. Browser-facing changes additionally run `npm run test:browser`. Performance
claims must identify corpus sizes and include serving costs, not only SQLite timings.
