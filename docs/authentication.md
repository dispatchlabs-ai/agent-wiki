# Authentication and single-space access

The first foundation is implemented: one content repository and trace archive form
one space, with Google/OIDC and local human identities and direct reader/editor/manager grants.
Named agents now have a [registration and credential setup](agent-setup.md).
Multi-space composition and organization/group grants remain later milestones. The control store includes the organization and group records
needed for that work; these do not yet add implicit membership or access.

## Operator setup

Google sign-in connects directly to Google OIDC; no broker is required. Personal
Google and Workspace accounts use the same path, without a hosted-domain or group
requirement. Local email/password accounts also work independently of any provider.
Both paths receive only explicit space grants; matching email addresses never link
identities or transfer permissions.

Export the common server configuration through your configuration/secret system
so both operator commands and the server receive it:

```sh
export WIKI_CONTROL=/absolute/private/path/control.sqlite3
export WIKI_ORIGIN=https://wiki.example.org
export WIKI_REPO=/absolute/path/to/content
export WIKI_WRITE=1
export WIKI_LOCAL_LOGIN=1
```

The control database's parent directory must already exist and be private to the
service account. The database is created with mode 0600. Use a different file from
the disposable content search index. Keep credentials out of shell history and Git.
Local login is enabled by default; set `WIKI_LOCAL_LOGIN=0` to disable it.
Shared hosting requires HTTPS.

### Direct Google login

Create a Google OAuth **Web application** client, configuring its exact authorized
redirect URI as `https://wiki.example.org/auth/callback`. Configure the consent
screen audience as **External** to admit personal Google accounts as well as
Workspace accounts. While the application is in testing, add the intended users
to its test-user list. Follow Google's publishing requirements before broader use.
Request only `openid profile email`; this application does not request group access.
See [Google's OpenID Connect documentation](https://developers.google.com/identity/openid-connect).

```sh
WIKI_GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID
WIKI_GOOGLE_CLIENT_SECRET=RETRIEVE_FROM_SECRET_STORE
```

Discovery uses `https://accounts.google.com`. Omit the generic OIDC variables when
using the Google preset. Discovery is lazy so a provider outage does not prevent
local accounts from signing in. For another provider, omit both Google variables
and set `WIKI_OIDC_ISSUER`, `WIKI_OIDC_CLIENT_ID`, and `WIKI_OIDC_CLIENT_SECRET`.
Generic providers must support Authorization Code, PKCE S256 and UserInfo.

### Initial manager and local accounts

For an empty installation, bootstrap a local manager without knowing any Google
subject in advance:

```sh
node scripts/local-account.mjs bootstrap manager@example.org 'Initial manager'
npm start
```

The command prints a private, single-use setup URL, valid for 24 hours. Open it to
choose a password. It initializes only an empty control store and refuses a second
bootstrap. There is no first-visitor administrator rule.

Alternatively, if the intended OIDC manager's exact subject is already known:

```sh
node scripts/bootstrap.mjs 'https://accounts.google.com' 'EXACT-SUBJECT' 'Initial manager'
```

An OIDC principal is keyed by `(issuer, subject)`, never by display name or email.
The subject must be the one issued to this exact client. Later Google users sign
in once, receive no grant, and appear in **Manage access**. Check their identity
before granting a role. No domain or company membership is inferred.

Managers can also choose **Invite someone without Google** in **Manage access**.
Share the generated setup URL privately with the intended person. The application
does not send email or verify mailbox ownership; email is a local login name.
Invited people choose their own password and receive no organization membership,
group membership, or access automatically. Grant reader/editor/manager access
separately. Readers see content; editors may edit when `WIKI_WRITE=1`; managers
also manage grants. The last active manager cannot be removed through the grant
endpoint. A Google account and a local account with the same email remain separate.

Local passwords require 15–1024 characters and use salted scrypt with N=131072,
r=8, p=1. At most two derivations run concurrently; excess work receives 429.
Unknown accounts perform a dummy derivation. Durable limits allow ten attempts per
email or password-change account per 15 minutes and 200 per socket source address.
Behind a proxy, that source limit is shared: forwarded headers are not trusted.
There is no public signup, email delivery, MFA, or self-service recovery in this
foundation. **Your account** allows password changes with the current password;
changes rotate the session and invalidate other sessions.

## Session and request behavior

`openid-client` performs discovery, Authorization Code exchange with PKCE,
state/nonce and ID-token claim validation. UserInfo is bound to the token subject.
Login attempts expire after five minutes and are consumed once. The opaque login
cookie binds the callback to the initiating browser. Failed callbacks disclose no
provider tokens or error details. Login capacity is bounded to 1,000 pending flows.

Sessions expire absolutely after eight hours. Only a SHA-256 digest of the random
session token is stored; cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS.
`GET /api/me` returns identity, current space role, and the session CSRF token.
Every browser mutation requires exact Origin and `X-Wiki-CSRF`. Anonymous local
sign-in/setup forms use a separate random cookie-bound CSRF token; authenticated
mutations use the session token. Article edits additionally
require `X-Wiki-Write: 1` and JSON. Development identity headers are never accepted.

**Sign out** deletes the local session and expires its cookie. It does not log the
person out of the upstream identity provider or their other applications. A later
login may reuse the provider's existing SSO session. Upstream suspension does not
invalidate an already established local session immediately: revoke the local
grant/session for immediate local removal. Back-channel logout and provider session
synchronization are not implemented.

All content, search, history, trace, authoring, and detailed-health routes check
current grants. A signed-in person without access receives the same 404 for real
and unknown resources. Anonymous API requests receive 401. Static assets, the
sign-in flow, and `/healthz` carry no content and remain public. Responses have no
global Git commit header and use `Cache-Control: no-store`. Async responses recheck
current membership before release; broken control-store queries fail closed.

The writer takes its portable directory Git lock and then an immediate control-store
transaction, rechecks the session and editor grant, and retains that transaction
through local Git publication. Grant changes serialize against this transaction.
If revocation wins, a queued write fails. If publication wins, its commit remains.
HTTP operation receipts use actor-scoped storage identities, retain the public
operation ID, and include the trusted actor ID; payload actor fields cannot change
attribution. This is not yet the full SQL/Git crash-recovery journal in milestone 4.
The direct CLI writer is trusted operator maintenance, outside HTTP authorization.

## Synthetic development and verification

`npm run example` runs the existing loopback-only synthetic reader without a
provider account. It cannot serve operator content. The dedicated authentication
browser tests start the `oidc-provider` standards fixture on ephemeral loopback
ports with fictional owner/visitor accounts and a separate synthetic repository.
That fixture must never authenticate real content.

Browser tests exercise actual redirects, code exchange, PKCE, sessions, editing,
manager grants, and logout through this provider. HTTP tests cover content-route
boundaries, expired sessions, forged headers and callbacks, CSRF, actor-bound
receipts, cached reads after revocation, queued writes, control-store failure, and
revocation during asynchronous trace rendering.

Browser coverage also exercises local invitation, password setup, direct grants,
email/password sign-in and password change without group membership. Unit tests
cover one-use/expired links, reset revocation, hashing, identity separation and
rate limits. Only synthetic accounts and content are used in these tests.

A live Google round trip remains an installation acceptance step: Google
client credentials and callback registration are operator-specific.
Record that check with the exact client registration and HTTPS proxy before
considering Google login operational.

## Recovery

Back up the authoritative control database together with the full content Git
repository and immutable trace archive. Stop the service and writers before
copying the SQLite file and any WAL, or use SQLite's consistent backup facilities.
Protect the backup like credentials and private content. A restore of old sessions
can restore still-unexpired login rights. Before reopening, invalidate browser
sessions, login attempts, and invitation links; remote OAuth authorization codes,
access/refresh tokens and grants; and legacy agent bearer tokens/runs. Disable
restored signing keys and delegations until their owners and current authorization
have been reconciled. These are trusted offline operator operations against the
restored control database. Re-enroll keys and reconnect clients afterward.

A credential reset does not reconcile restored permissions or password hashes.
Review principals, space roles, agent ownership and permission grants against
current authorizations, and reset any passwords changed since the backup. Keep
the installation offline until this review is complete.

Do not rebuild the control database from content or delete it as an index repair.
Loss of control state loses principal mappings and grants. Search databases and
render caches remain disposable. Recovery of administrative access is explicit
operator maintenance of the backed-up control store; there is no unauthenticated
remote recovery endpoint.

For a forgotten local password or expired setup link, the trusted operator runs:

```sh
node scripts/local-account.mjs reset person@example.org
```

This immediately disables the old password, invalidates every session for that
account, and prints a new one-use setup URL. Deliver it privately after verifying
the person's identity. Space managers cannot reset other people's passwords.
After restoring control-store backups, also delete `invitations` to invalidate
setup links that may have been consumed after the backup.

For unattended bootstrap, `scripts/provision-local.mjs EMAIL NAME` reads the
initial password from `WIKI_BOOTSTRAP_PASSWORD` and initializes only an empty
store. Inject it from the operator's secret store. It prints no password or setup
token, and ends the temporary setup session immediately.

Regular MCP clients can use [registered agent credentials](agent-setup.md), with
short-lived bearer tokens supplied and renewed by the stdio adapter. Browser-session
clients still send the `wiki_session` cookie and, for POSTs, its `X-Wiki-CSRF` token
with the exact Origin. WebMCP uses the signed-in browser automatically.
Original `/api/evidence/v1/` requests now pass through the same authorization check;
never proxy that route directly to the underlying archive on a hosted domain.
Use one canonical origin, redirecting aliases before login so OIDC cookies and
callbacks remain on the same host.

## Opening protected links

A signed-out browser opening an article, conversation, or file receives a sign-in
page. Google/OIDC and local login return to that same path, query, and citation
anchor. Return destinations are restricted to this wiki. API clients and embedded
image requests still receive 401 without credentials; a browser session is not
automatically shared with another browser profile or an external image renderer.

For interactive MCP clients, prefer [remote agent connections](remote-agents.md).
Account-directory selection in the Agents page requires current wiki membership
as well as permission to manage an agent; agent-only invokers retain access to
their assigned agents without access to the human directory.
