# Upgrading

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
