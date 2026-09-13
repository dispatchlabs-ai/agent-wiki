# Security

This initial-development project is intended for trusted operators and readers. Fixes target
the current development branch; there is no supported stable release or response SLA.

The server binds to loopback. Remote hosting requires an HTTPS reverse proxy and
the built-in session/grant configuration supplied by the operator. Host and
Origin checks complement authentication. Every authorized reader can access every
article, historical revision and imported trace in the instance. Keep separate
trust domains in separate instances.
Never expose a private-content instance directly to the public internet.

Traces preserve all original fields and may contain credentials, personal data,
and hostile instructions. Import only material appropriate for every reader.
Markdown sanitization prevents executable markup; it does not make historical
instructions trustworthy or redact sensitive content. Local repository writers,
Git configuration, and filesystem owners are trusted. This is not a sandbox for
untrusted repositories. Public-reader traffic needs proxy rate and resource limits.

Report vulnerabilities using [GitHub private vulnerability reporting](https://github.com/dispatchlabs-ai/agentic-wiki/security/advisories/new),
which is enabled for this repository. Include the affected version, expected and
actual behavior, and a minimal synthetic reproduction. Do not post exploit details,
real traces, credentials, or private data in a public issue. If GitHub reporting is
temporarily unavailable, wait for a private channel rather than publishing details.

## Authenticated hosting

The standalone server requires the authoritative control store and explicit
bootstrap described in [authentication](docs/authentication.md). Google/OIDC and
local accounts establish opaque, expiring sessions. Same-origin CSRF protects
mutations, including MCP POSTs. Current space grants protect articles, original
evidence APIs, media, previews and MCP calls; internal MCP requests retain the
caller's session. There is no unauthenticated detailed health or Git commit header.
`/healthz` reports only process availability. Operator-selected upstream evidence
services must remain on a private interface behind this boundary. The loopback
synthetic example and raw `createWiki` embedding interface are separate from the
standalone authenticated entry point; embedders must supply `control` for real
content and cannot rely on a reverse proxy's network boundary alone.
