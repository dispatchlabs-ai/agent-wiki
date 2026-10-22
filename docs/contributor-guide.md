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

## Compatibility and examples

Linux and macOS are supported through the portable directory writer lock. Use
Node 24.22.1+ (24.x) or 26.12.1+ (26.x), including the required security fixes
and built-in SQLite implementation. An engines range is not proof that every
matching runtime has been qualified. For Windows, follow the
[Ubuntu under WSL2 walkthrough](getting-started.md#windows-with-wsl2); native
Windows server support remains unverified.

The automated test suites, test fixtures, and acceptance runners were removed on
October 16, 2026. `npm run check` checks generated contracts, formatting, and
static types. Run `npm run example` for manual browser and agent verification
using the bundled synthetic articles and traces. Earlier verification results
remain dated evidence in [verification](verification.md), not current coverage.

`examples/traces/codex.jsonl` and `pi.jsonl` are synthetic format examples. For a
newly supported variant, document the harness version and record shape and
verify original values, dialogue classification, and citation lines using
synthetic data. Unknown records remain inspectable context; change `TRACE_VERSION`
when projection or index interpretation changes.

## Core contracts for behavior changes

1. **Receipt correctness.** Preserve blob IDs and lifecycle numbering across edits,
   deletion/recreation and retries; verify the affected workflow with synthetic data.
2. **Degraded operation.** Keep independent components usable when a derivative
   fails, expose component health, and prove recovery after rebuilding.
3. **Search grouping.** Preserve native identity and verified lineage; never merge
   repeated dialogue solely by text. Verify branches, revisions and pagination.
4. **Resource bounds.** Measure cold-page work, spool disk use, large catalogs and
   OS peak RSS. Preserve full explicit reads and integrity checks; the harness owns
   context management. Avoid unverified data reaching a response.
5. **Additional format support.** Add one documented synthetic format variant at
   a time using the example rules above.

`npm run typecheck` checks JavaScript/JSDoc across `src/` and the shared edit
contract. `src/contracts.mjs` describes revision, trace metadata, search and worker
boundaries. Newly persisted receipts require `revision_id`; legacy receipt shapes
remain separately represented. This is incremental boundary checking, not a claim
that every arbitrary upstream payload has a fully closed schema.

Discuss interface changes before implementation. Keep a contribution focused on one
behavior, run `npm run check`, and include the specific manual verification or
benchmark result. Performance
claims must identify corpus sizes and include serving costs, not only SQLite timings.
