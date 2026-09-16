# Use an agent from another machine

Connect an MCP client directly to `https://wiki.example.org/mcp`, sign in as
**yourself**, and choose an agent you have permission to use. The client needs no
wiki checkout, Node installation, adapter, or agent signing key. The wiki server
hosts definitions and enforces access; the client still runs its own model.

## Define and share

Open **Your account → Agents and connections** (`/agents/`). Create an agent with
a name, instructions, and the wiki tools it should expose. It becomes its own
principal, owned by you. A space manager grants it read or read/write wiki access.
Creation alone grants no content access.

An owner can grant another signed-in person **Use agent**, **Edit definition**, or
**Manage access** independently. Check the displayed identity before selecting a
person. Users without personal space access may still use an agent explicitly
shared with them: that permission allows use of the agent's own authority.

Changing an agent's definition creates a new immutable version. Existing
connections retain their approved definition; reconnect to use the new version.
The advertised tool list limits MCP operations; the underlying HTTP API continues
to enforce scope and space grants, not the discovery list as an additional ACL.

## Connect Codex

With a remote-MCP/OAuth capable Codex installation:

```sh
codex mcp add wiki --url https://wiki.example.org/mcp
codex mcp login wiki --oauth-client-registration dcr --scopes wiki:read,wiki:trace,wiki:write
```

The add command may start login itself. Complete browser sign-in and select the
agent; run the separate login command if needed. Request only read/trace scopes
when you do not want editing. Client support and command options vary by version;
use its native help. The server supports public dynamic client registration (DCR),
Authorization Code with mandatory S256 PKCE, and rotating refresh tokens.

Start normal `codex` and ask it to search/read an article and a matching trace.
Verify actual tool calls, not just the client's connection indicator. Other
remote MCP clients use the same HTTPS URL and browser authorization. Pi requires
a compatible remote MCP extension; no universal Pi-core OAuth support is claimed.

Each authorization records the signed-in human as **initiator**, the selected
agent as **actor**, and the definition and scope used. This initial stateless HTTP
implementation has one recorded connection run per authorization, lasting at most
30 days. Multiple client sessions sharing that saved authorization share its run;
this is not per-model-turn or per-terminal-process trace isolation. A new login
creates a new run. Five-minute access tokens renew within the same authorization;
renewal cannot extend the 30-day expiry or increase scope.

## Revoke access

Disconnect a client under **Your connections**. Its tokens stop working
immediately. Removing a person's Use agent permission also permanently revokes
that person's existing remote grants; regranting permission requires a new login.
Agent suspension, user suspension, run shutdown and current space rights are
checked on requests and again at publication. Client logout through the OAuth
revocation endpoint revokes the corresponding connection. Browser logout ends the
browser session; use Disconnect to revoke a separately authorized MCP client.

The client stores its own OAuth credentials. Long-lived agent signing keys stay
out of user machines. Token/code values are hashed in the authoritative control
store, which must be backed up along with the other identities and permissions.

## Server interfaces and boundaries

- `GET /.well-known/oauth-protected-resource/mcp` and
  `GET /.well-known/oauth-authorization-server` provide discovery.
- `POST /oauth/register` registers public clients with exact HTTPS or loopback
  HTTP redirect URIs. No client-supplied metadata URL is fetched.
- `GET /oauth/authorize` requires a human wiki session and explicit agent choice;
  same-origin POST with the session's CSRF token confirms or denies consent.
- `POST /oauth/token` exchanges one-use, 60-second codes with the matching client,
  redirect URI and PKCE verifier; refresh rotates tokens. Reusing a consumed
  refresh token revokes its grant. Clients must serialize refresh and reauthorize
  if a lost response leaves them holding an already-consumed refresh token.
- `POST /oauth/revoke` accepts a client ID and one of its tokens.
- `GET /api/agents` lists the current human's shared/owned agents.
  `POST /api/agents` accepts a JSON `action`: `create` (`name`, `definition`),
  `configure` (`agent`, `definition`), `permission` (`agent`, `principal`,
  `permission`, `enabled`), `role` (`agent`, `role`), or `revoke` (`connection`).
  Human session and CSRF checks apply; each action checks its own authority.

Remote consent currently selects independent agent authority in the default space.
It does not implement delegated-human mode, model hosting, scheduling, client-ID
metadata documents, or arbitrary third-party ChatGPT connector onboarding.
Definitions accept the existing instructions/tool schema. These are application
choices layered on MCP/OAuth, not a new agent-execution protocol.

The [operator signing-key adapter](agent-setup.md) remains supported for existing
unattended integrations. Human users should use this remote connection instead.
