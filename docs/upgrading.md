# Upgrading

## 0.8.7 — publication without hard links

New article-media publications use complete asset/manifest directories and atomic
filesystem rename. Existing publications and URLs remain readable and unchanged.
Stop old publishers before upgrading, and recover any incomplete legacy pair
before republishing it. Once new-format media is published, a 0.8.7-or-newer
server is required to read it. See [publication and recovery](article-media.md).

## 0.8.6 — published article media

`WIKI_ARTICLE_MEDIA` optionally points to an independent private store for images
and PDFs deliberately published to article readers. Existing installations need
no data migration and retain the evidence-only meaning of `/media/` and `/files/`.
Do not point this setting at the trace archive, evidence provider cache or engine
assets. Create and back up a dedicated directory, publish reviewed bytes through
the operator script, then add the returned content-addressed URL to an article.
See [published article media](article-media.md).

## 0.8.2 — optional selective article reads

Existing reads return the same complete articles. Clients can opt into section,
outline and field selection using the [read API](api.md#selective-article-reads).
Refresh MCP tool discovery to see the new arguments in clients that cache schemas.
Keep full current reads before edits. No configuration or persisted-data migration
is required for this addition.

## 0.7.0 — complete traces without a file-size cutoff

The imported-trace size policy has been removed. Delete `WIKI_TRACE_MAX_BYTES`
from operator and service configuration; it no longer limits accepted files.
Import, search indexing and reads process the complete original snapshot
incrementally. Existing snapshots, accounts, indexes and citations need no migration.
Resource use still depends on individual records, selected responses, annotation
counts and full-source integrity I/O; see [trace handling](traces.md).

## 0.6.0 — article readers and editorial evidence

This minor initial-development release intentionally narrows `reader` authority.
Reader accounts and agents keep published articles, history and citations but lose
original conversations, trace search, attachment previews and downloads. Editorial
evidence requires an editor/manager grant. It remains available with WIKI_WRITE=0.
Scoped agents additionally require `wiki:trace`; read/write scope alone does not
permit source lookup or quotation verification.

Before upgrading, review which principals actually need original evidence. Keep
article-only clients on reader with `wiki:read`; explicitly grant editor and trace
scope only to intended editorial clients. Existing reader machine configurations
requesting `wiki:trace` must be narrowed to `wiki:read`. Existing enrolled maximum
scopes are still intersected with current roles. No role is automatically promoted.
OAuth clients whose scope exceeds a reduced grant must sign in again at the narrower
scope; reconnect to refresh tool discovery. Existing receipt and content formats
are unchanged. Published quotations are not redacted or rewritten.

The new ordinary CLI authenticates over HTTP; previous operator scripts keep their
explicit filesystem authority. The public OpenAPI contract is versioned with the
source. A source upgrade does not reconfigure or deploy a running installation.
Read [CLI recovery](cli.md#output-and-credential-recovery) before copying profiles
or rotating OAuth credentials. Run `scripts/check` with synthetic data after a
fresh checkout and `npm ci`.

## 0.5.0 — source reset

Agent Wiki owns its agent identities, definitions, permissions, signing-key
enrollment, sessions and resource grants. External agents connect through the
public HTTP/MCP interfaces. There is no bundled agent-management application,
external authority database, or execution-service integration.

Version 0.5.0 starts a new public Git history. Older branches, tags and release
records are retired. Use a fresh clone for this source release; do not merge the
old source history back into it. Content repositories are independent of the
engine repository.
