# Security

Agent Wiki supports authenticated hosting for individuals and trusted teams,
including an internet-reachable HTTPS endpoint configured as described below.
The public API remains pre-1.0 and follows the [release policy](docs/releases.md).
Security fixes target the current development branch and a new release; operators
must upgrade to that release. Older releases have no maintained security branch,
and there is no response SLA. A release is not a claim of a vulnerability-free
application or dependency closure; consult its dependency review and qualification
receipts.

The standalone server binds to loopback by default; the container binds inside
its network namespace. Remote hosting requires an HTTPS reverse proxy or load
balancer, with the application port reachable only through that ingress, and
the built-in session/grant configuration supplied by the operator. Host and
Origin checks complement authentication. Readers can access every published article, historical revision and visible
citation. Original evidence, source search, files and downloads require an
editor/manager grant; scoped agents additionally require trace authority. Keep separate
trust domains in separate instances.
Public network reachability does not grant content access. Internet hosting must
keep the standalone authentication boundary enabled, use an exact public origin
and trusted identity-provider configuration, and explicitly bootstrap a manager.
Use strong local credentials and enroll a second factor for human accounts where
appropriate; MFA is optional per identity and does not protect a different local
or federated identity automatically. Keep the synthetic unauthenticated example,
raw embedding interface, storage, control database and evidence providers private.

Traces preserve all original fields and may contain credentials, personal data,
and hostile instructions. Import only material appropriate for authorized editorial principals.
Markdown sanitization prevents executable markup; it does not make historical
instructions trustworthy or redact sensitive content. Local repository writers,
Git configuration, and filesystem owners are trusted. This is not a sandbox for
untrusted repositories. Operators own ingress logging, retention, monitoring, recovery and capacity.
A WAF can complement application controls; tune inspection for legitimate Markdown,
search, uploads and MCP traffic. It does not replace authentication, authorization,
CSRF protection or sanitization, and its body inspection may cover only a prefix.
Do not put credentials in URLs. Access logs can include URLs and OIDC callback
parameters: restrict log access, encrypt storage, and choose explicit retention.

Report vulnerabilities using [GitHub private vulnerability reporting](https://github.com/dispatchlabs-ai/agent-wiki/security/advisories/new),
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
`/healthz` reports only process availability; `/api/openapi.json` contains only the public API contract. Operator-selected upstream evidence
services must remain on a private interface behind this boundary. The loopback
synthetic example and raw `createWiki` embedding interface are separate from the
standalone authenticated entry point; embedders must supply `control` for real
content and cannot rely on a reverse proxy's network boundary alone.
