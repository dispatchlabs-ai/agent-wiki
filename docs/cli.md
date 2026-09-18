# Use the wiki from a terminal

The ordinary CLI is an authenticated HTTP client. It reads no content repository,
control database or evidence archive. Install this source checkout with Node 24.19+
and `npm ci`, then run `node bin/wiki.mjs --help` (or `npm run wiki -- --help`).
There is no published npm package or global executable.

## Sign in

For a local email/password account, pipe the password from your secret manager;
never put a password in command arguments or a checked-in file:

```sh
YOUR_SECRET_COMMAND | node bin/wiki.mjs login --url https://wiki.example.org \
  --email person@example.org --password-stdin
node bin/wiki.mjs search 'project decision'
node bin/wiki.mjs read example-article
```

This uses the same human principal, eight-hour session lifetime and permissions
as local browser login. The client supplies session CSRF and exact Origin for
mutations. A manager must already have granted the account access. Local password
login must be enabled on the server; this command cannot create an account.

For Google/OIDC or another browser sign-in, use the existing remote OAuth workflow:

```sh
node bin/wiki.mjs login --url https://wiki.example.org
```

Open the printed URL in a browser **on the CLI machine**, sign in, and explicitly
choose an agent you are allowed to invoke. The wiki must already have that shared
agent and its content grant; see [remote connections](remote-agents.md). The CLI
binds a temporary random-port loopback callback for up to five minutes and uses
the MCP SDK's PKCE, state and issuer checks. It never receives the identity
provider's password. For a remote terminal, use local-account or machine login,
or run the CLI on the workstation with your browser. No callback is exposed to
the network.

**Identity is explicit:** password login acts as the human; browser OAuth acts as
the selected agent, with the human recorded as initiator. Agent authority is not
inherited from the human's space role. Run `whoami` before writing. OAuth defaults
to `wiki:read`. Request evidence and/or writes explicitly when needed:

```sh
node bin/wiki.mjs login --url https://wiki.example.org \
  --scope 'wiki:read wiki:trace wiki:write'
node bin/wiki.mjs whoami --json
```

For an unattended process, an operator can enroll a separate signing credential
using [agent setup](agent-setup.md), then use:

```sh
node bin/wiki.mjs login --connection /absolute/private/path/agent.json
```

The client stores the connection path, not a copy of the signing key. Each CLI
command obtains a short-lived run and closes it on completion. Retries remain
bound to the credential's stable authority. The connection file and key must be
owned regular files with mode 0600. Reader enrollments default to `wiki:read`;
editor enrollments can additionally request trace and write scopes.

## Read selected passages

```sh
node bin/wiki.mjs read guide --fields title,sections --json
node bin/wiki.mjs read guide --revision 2 --section section-deployment --fields title,body --json
node bin/wiki.mjs read guide --fields revision_id --json
```

Section anchors come from search or the outline. A section includes its nested
subsections; `--section ''` selects the introduction. Selective responses retain
revision identity and a stable citation URL and are marked `partial: true`.
Use the returned revision number for further passages from the same version.
See [selection semantics](api.md#selective-article-reads). Omit both selectors and
read current again before editing; a selected body is not a complete replacement.

## Create, edit and retry

Prepare one update in `article.json` outside the content checkout:

```json
{
  "title": "Project decision",
  "description": "The agreed direction and its context.",
  "topic": "Projects",
  "body": "A short, sourced explanation.",
  "summary": "Record the project decision"
}
```

```sh
node bin/wiki.mjs create project-decision --file article.json \
  --operation-id project-decision-create-001 --json
node bin/wiki.mjs read project-decision --json
node bin/wiki.mjs edit project-decision --file article.json \
  --revision BLOB_ID_FROM_READ --operation-id project-decision-edit-001 --json
node bin/wiki.mjs history project-decision
```

Read the article before editing and supply that exact revision. The server checks
it again under the writer lock; the CLI never silently retries against a newer
revision. Writes require an editor grant and server `WIKI_WRITE=1`. Agent writes
also require `wiki:write`; verifying new source quotations needs `wiki:trace`.

Keep the exact file, operation ID, expected revision and login identity when
retrying an uncertain save. A retry through CLI, HTTP, MCP or WebMCP recovers the
same durable commit. Changing the input under the same operation ID is rejected.
After a confirmed conflict, read current again, reconcile and use a new ID.
`save --file batch.json` accepts the complete 1–10-update API request. `--file -`
reads stdin. `preview --file note.md` renders Markdown without saving or fetching
source contents. Receipts report local commit, remote push and reader publication
separately; `push-failed` does not undo a committed change.

## Evidence and complete tool arguments

Readers can search/read published articles, historical articles and their visible
citations. Original evidence needs an editor/manager grant; agent clients also
need trace scope. The same boundary applies to snippets, captured files, previews,
raw records, downloads and provider errors.

```sh
node bin/wiki.mjs trace-search 'recorded decision' --json
node bin/wiki.mjs traces --limit 20 --offset 0 --json
node bin/wiki.mjs trace chat-CONVERSATION_ID --limit 20 --offset 0 --json
node bin/wiki.mjs file ASSET_ID.bin --json
```

Use a real ID returned by search. Imported archives use 64-hex snapshot IDs and
`trace ID --page N`; external evidence uses `chat-` IDs and limit/offset. Imported
archives also expose `trace-lines ID --start N --end N`, `trace-sessions`, and
`trace-provenance KEY`. Provider-specific capabilities are listed by authoring
discovery. For full tool parameters (category, time range, text windows or filters),
use `call wiki.TOOL --file arguments.json`. This uses the same tool-to-HTTP mapping
as WebMCP. File results include protected download URLs; byte downloads use HTTP
with the same credential and are intentionally not written to disk by the CLI.

## Output and credential recovery

`--json` prints one JSON result or `{isError, code, status, error}` to stdout.
Readable mode prints article Markdown, concise search/history results or formatted
JSON for other operations. Diagnostics and the browser login URL use stderr.
Exit codes: 0 success, 1 request/network failure, 2 invalid usage/input, 3 conflict
or busy profile, 4 authentication/permission denial (including concealed 404s).

Profiles default to `~/.config/agent-wiki/cli.json`, written atomically with mode 0600. Use `--config /private/path/profile.json` for a separate service or identity.
Profiles contain credentials; exclude them from Git, shared folders and logs.
No global MCP/client configuration is changed. Authentication never falls back to
a different identity when access is denied.

Commands serialize on a per-profile `.lock` directory to protect rotating refresh
tokens. Concurrent use returns `CLIENT_BUSY`; retry after the other command ends.
After a crash, confirm its process has stopped before removing that lock directory.
A persisted `refreshPending` means a refresh might already have consumed its token;
the client refuses to replay it. Use `logout` then a fresh login. If the credential
or service cannot be recovered, `logout --forget` removes only the local profile
and explicitly reports that remote revocation has not been established. Revoke
any still-active connection through **Your connections** in the wiki.

`logout` normally revokes the server session/OAuth connection and removes its
profile. A definitively expired human session can also be removed and replaced.
Machine logout removes the local connection profile; operator enrollment remains
until independently revoked. Network failure during revocation retains credentials
for retry. The CLI does not automatically retry content mutations.

Direct-storage commands (`src/editor.mjs`, bootstrap, imports and agent-admin)
are trusted operator maintenance with filesystem authority. They are not ordinary
CLI shortcuts and are not restricted by service grants. See [the interface
inventory](interfaces.md) and [recovery](authentication.md#recovery).
