# Register an agent and connect its runtime

For people connecting from another machine, use the simpler
[remote user-to-agent connection](remote-agents.md). No local adapter or agent
signing key is needed. The rest of this guide describes the operator-managed
signing-key path retained for existing and unattended integrations.

This is the working setup for named agents on the current **single-space** wiki.
Each agent has its own principal and public-key registration. Each adapter process
starts a distinct recorded run and obtains five-minute bearer tokens. The model
receives tools and results; the adapter supplies credentials.

The wiki does not execute models or schedule work. Use Codex or another stdio MCP
client for execution. A human browser login is separate from agent authentication.
For the distinction between wiki identity and runtime agent definitions, plus
Codex, Pi, and Claude compatibility, see the [runtime research](agent-runtime-research.md).

## Where does an agent live? Example: Sam

Sam is a stable **wiki principal**, not a process permanently attached to one
computer. His name, ID, owner, versioned definition, grants, keys, and runs live
in the wiki server's control database, at the path configured by `WIKI_CONTROL`.
For the example deployment in this guide, that is `/var/lib/wiki/control.sqlite3`;
it is not a universal installation path.

Codex, Claude, or Pi executes Sam on a runtime machine. That machine holds a
connection file and signing credential and launches the wiki adapter. Sam can run
from a Mac even when the wiki server runs on Linux. The machine must be able to
reach the canonical HTTPS wiki endpoint.

For a Mac user named `you`, example absolute paths are:

```text
/Users/you/.config/agent-wiki/sam.json
/Users/you/.config/agent-wiki/sam.key.pem
/Users/you/.config/agent-wiki/sam.public.json
/Users/you/.codex/config.toml
```

The last file is Codex-specific; Claude and Pi use their own runtime configuration
in step 4. These are paths to create, not files shipped by this repository. The
public registration is submitted to the wiki operator; the private key stays with
the runtime, even if runtime and wiki happen to share a physical server.

Create Sam once with steps 1–2, using `--role editor` in both commands for read/write
access. To use the **same Sam on another machine**, generate a different key there
with `--agent SAM-UUID`, then register its public file under Sam's existing owner,
name, definition, and intended role/mode. For example, on the second machine:

```sh
node scripts/agent-keygen.mjs /Users/you/.config/agent-wiki/sam.json \
  --origin https://wiki.example.org --name 'Sam' --agent SAM-UUID --role editor
```

Preserve Sam's current definition if it was customized; enrollment rejects a
mismatched definition. Follow steps 2–5 with this new file. This adds a key to Sam;
it does not create another Sam. Each machine's key can be revoked separately.
Independent enrollment sets Sam's standing space role, so do not use a different
role casually when adding a machine. Separate keys are not separate principals.
Separate adapter processes create separate runs of the same principal; runtimes
that share an adapter share that run.

## Who may invoke Sam?

Sam's permissions to use the wiki are separate from another principal's permission
to control Sam:

| Permission                | Meaning                                |
| ------------------------- | -------------------------------------- |
| Space reader/editor grant | What Sam can read or write in the wiki |
| `invoke` on Sam           | Who may initiate work as Sam           |
| `configure` on Sam        | Who may change Sam's stored definition |
| `manage-access` on Sam    | Who may grant control over Sam         |

The implemented control store permits Sam's active owner all three agent-control
operations; another active principal needs the corresponding explicit grant.
Being a wiki reader or editor does not itself grant control over Sam. In independent
mode, an authorized invoker need not have Sam's own space rights; delegated mode
uses the explicit subject's delegation instead.

**The current operator setup is credential-based, not a shared “Ask Sam” service.**
Enrollment binds the key's initiator to the owner. On token issuance and subsequent
access, the wiki checks that registered initiator's current `invoke` authority.
It does not authenticate whichever person happens to be typing into the runtime.
Anyone who can use Sam's private key can operate the adapter under that registered
authority. A human login to the wiki does not prove who is behind a separate
key-authenticated adapter process.

The remote Agents page now exposes agent-control grants. The operator CLI does not
expose granting `invoke` to another person, and this operator path has no task-submission API/UI,
hosted model runner, or scheduler. Do not interpret these data-model capabilities
as a completed multi-user invocation product.

For a shared server, the remaining service must authenticate each requester,
check their `invoke` permission, bind the actual initiator and authority mode to
the run through a trusted server interface, and enforce access to task results.
Its runtime must keep Sam's key out of requesters' reach. Simply putting the existing
owner-bound adapter behind a web form does not implement that caller attribution.
The wiki server continues enforcing Sam's grants/delegation independently of the
runtime. The [remote MCP connection](remote-agents.md) implements authenticated human invocation
without hosting model execution. The owner-bound signing-key adapter described
here still does not identify the person typing.

## Choose the runtime, then follow the shared steps

Complete steps 1–3 once for **each named wiki identity**, then choose one runtime
in step 4 and complete step 5. Use Node 24.19+ and Git; commands in steps 1–3 run
from the engine checkout on the machine named in each step. Replace every example
path and ID with your own values. The Node executable used by the runtime must
also meet that version requirement; `/usr/bin/node` below is only an example.

| Runtime          | Step 4 configuration                     | Current verification                                           |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Codex            | User `~/.codex/config.toml`              | Model-driven article and trace search/read verified            |
| Claude Code      | User-scoped MCP configuration            | Synthetic model-driven search/read/write and shutdown verified |
| Claude Agent SDK | `options.mcpServers` in your application | Documented integration; application acceptance pending         |
| Pi               | A Pi extension that launches the adapter | Bundled extension; synthetic model acceptance passed           |

For example, `codex-researcher.json` and `claude-researcher.json` should be generated
separately if they represent different agents. Copying or renaming an existing
connection file does **not** create a new identity. Sharing a file intentionally
shares the principal and its permissions.

## Files you create

| File or record           | Location                       | Contents                                                                 |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------ |
| `researcher.json`        | Runtime machine                | Endpoint, agent ID, key ID, requested scopes, private-key reference      |
| `researcher.key.pem`     | Runtime machine, mode 0600     | Private signing key; never copy to the wiki server or Git                |
| `researcher.public.json` | Copy to wiki operator          | Agent name, IDs, public key, expiry, initial definition                  |
| Wiki control database    | Wiki server                    | Principal, owner, grants/delegation, registered key, runs, token digests |
| MCP configuration        | Runtime's normal configuration | Command to launch the adapter with `researcher.json`                     |

The engine checkout and its locked production dependencies must be installed on
both machines (`npm ci`). The adapter uses the maintained MCP SDK's private-key JWT
client authentication; the server validates assertions with `jose`.

## 1. Generate a credential on the runtime machine

Run from the engine checkout, replacing the origin and output path:

```sh
node scripts/agent-keygen.mjs /home/you/.config/agent-wiki/researcher.json \
  --origin https://wiki.example.org --name 'Researcher'
```

This creates the three files above without printing the private key. Existing files
are never overwritten. The public registration expires in 90 days by default;
`--days` accepts 1–365. For an editor connection, add `--role editor` here and at
registration. Reader is the default.

The connection file looks like this (the command fills in actual IDs):

```json
{
  "version": 1,
  "endpoint": "https://wiki.example.org/mcp",
  "agent": "AGENT-UUID",
  "key": "KEY-UUID",
  "privateKeyFile": "/home/you/.config/agent-wiki/researcher.key.pem",
  "scope": "wiki:read"
}
```

Keep the private key in the runtime's secret store or a private file. To inject it
through a credential manager, replace `privateKeyFile` with
`"privateKeyEnv": "WIKI_AGENT_PRIVATE_KEY"` and have that manager launch the adapter
with the PEM value in that environment variable. Do not put the value in the MCP
configuration, instructions, command arguments, or conversation. Back up the
credential through the same secret store used for other runtime credentials.

A file owned by the same OS account as a Full Access agent is **not an isolation
boundary** from that agent's shell tools. Stronger separation requires a broker or
credential service running outside the model's accessible account/container. This
adapter keeps secrets out of its MCP messages; it does not create OS isolation.

## 2. Register the public file on the wiki server

Copy only `researcher.public.json` to the operator. Set `WIKI_CONTROL` to the
existing private control database, as for other wiki administration commands.
List the existing human identities to select the exact owner:

```sh
WIKI_CONTROL=/var/lib/wiki/control.sqlite3 node scripts/agent-admin.mjs people
```

Then register the public file:

```sh
WIKI_CONTROL=/var/lib/wiki/control.sqlite3 node scripts/agent-admin.mjs register \
  /tmp/researcher.public.json --owner HUMAN-PRINCIPAL-ID --role reader --mode independent
```

This creates an agent principal and explicitly grants it reader access. Owning the
agent does not copy the owner's rights. Repeating the exact registration returns
`changed: false`. A conflicting registration fails rather than silently replacing
an existing identity. No public registration API is exposed.

For a personal assistant using the owner's current rights, choose `--mode delegated`.
Registration creates an explicit, expiring delegation to that agent. It must fit the
owner's current rights. Removing those rights or revoking the delegation blocks
access even if the agent also has standing grants. An independent run uses its
own grants. These authority modes never fall back to one another.

The role determines the enrollment's maximum scope: reader permits published article reads; editor permits original evidence and writes. A connection may request a narrower
scope. This foundation has only the `default` space; unknown spaces are denied.

## 3. Verify the connection

Back on the runtime machine:

```sh
node scripts/agent-mcp.mjs /home/you/.config/agent-wiki/researcher.json --check
```

It prints the authenticated agent ID, run ID, and discovered tools, then closes
that run. It prints no token. Failures return a nonzero exit status.

## 4. Connect one runtime

### Codex

Add the following to the runtime's user Codex configuration, substituting actual
absolute paths. Manage it through your deployment system when one owns that file.

```toml
[mcp_servers.wiki]
command = "/usr/bin/node"
args = ["/opt/agent-wiki/scripts/agent-mcp.mjs", "/home/you/.config/agent-wiki/researcher.json"]
```

Start a fresh Codex session so the connection is loaded. The adapter obtains a
run on startup and renews its tokens automatically. No browser cookie or manually
copied bearer token is needed. It forwards the registered definition's instructions
and tool catalog, with the current space grants still enforced by the server.

### Claude Code

Authenticate the runtime separately from its wiki credentials. With an existing
Claude Pro/Max account, use the native subscription login:

```sh
claude auth login --claudeai --email you@example.org
claude auth status
```

Complete the browser authorization and confirm the intended account and subscription
in the status output. You do not need to create a Claude API key for this route.
An `ANTHROPIC_API_KEY` override can select API billing instead; do not mix provider
credentials accidentally. Claude owns its login storage and renewal; never place
its login token in the wiki connection JSON or public registration.
[Claude authentication](https://code.claude.com/docs/en/authentication),
[subscription setup](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan).

Before connecting real content, optionally run the repository's synthetic
model-driven acceptance check from the engine checkout:

```sh
node scripts/verify-claude.mjs --run
```

This uses your authenticated Claude CLI and model usage. It creates a temporary
wiki, trace index, editor identity, and key; exercises article/trace search/read,
saves and reads back a synthetic article, checks run closure, and removes the
fixture. No real wiki endpoint is used. Successful output has `verified: true`;
assertion failures exit nonzero. It is deliberately excluded from `npm run check`
so routine tests do not make billed model requests. Invocation without `--run`
only prints help.

After generating, registering, and checking a separate `claude-researcher.json`,
create `/home/you/.config/agent-wiki/claude-mcp.json` on the runtime machine:

```json
{
  "mcpServers": {
    "wiki": {
      "type": "stdio",
      "command": "/usr/bin/node",
      "args": [
        "/opt/agent-wiki/scripts/agent-mcp.mjs",
        "/home/you/.config/agent-wiki/claude-researcher.json"
      ]
    }
  }
}
```

For normal Claude sessions, register the adapter once at user scope:

```sh
claude mcp add --scope user --transport stdio wiki -- /absolute/path/to/node /opt/agent-wiki/scripts/agent-mcp.mjs /home/you/.config/agent-wiki/researcher.json
claude
```

The JSON above can also be used for a dedicated session:

```sh
claude --strict-mcp-config --mcp-config /home/you/.config/agent-wiki/claude-mcp.json
```

`--strict-mcp-config` limits this session to explicitly supplied MCP configuration;
it does not change wiki permissions. Use `/mcp` inside the session to check the
connection, then perform step 5. This example leaves your persistent Claude
configuration untouched. For project-wide configuration, the same JSON shape can
be used in `.mcp.json`; preserve existing server entries and follow Claude's project
trust/approval flow. See [Claude's MCP reference](https://code.claude.com/docs/en/mcp).

A Claude runtime agent definition is a separate file, normally
`.claude/agents/<name>.md` or `~/.claude/agents/<name>.md`. It describes behavior;
it is not the public wiki registration. Inline `mcpServers` may point to that
agent's connection, while a server-name reference shares the parent's connection.
Concurrent subagent process isolation remains unqualified; start with separate
top-level sessions. See the [research findings and reported limitations](agent-runtime-research.md#claude-code-and-claude-agent-sdk).

### Claude Agent SDK

In an application using `@anthropic-ai/claude-agent-sdk`, supply the same command
and arguments in `options.mcpServers`. This is an integration example, not a
shipped launcher or a tested SDK dependency in this repository:

```js
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Search the wiki for its getting-started article and read it.",
  options: {
    mcpServers: {
      wiki: {
        command: "/usr/bin/node",
        args: [
          "/opt/agent-wiki/scripts/agent-mcp.mjs",
          "/home/you/.config/agent-wiki/claude-researcher.json",
        ],
      },
    },
    allowedTools: ["mcp__wiki__*"],
  },
})) {
  if (message.type === "result") console.log(message);
}
```

The wildcard permits all tools this wiki connection advertises. Use selected tool
names or your permission handler if the application needs a narrower runtime
allowlist. Server-side grants still apply. Set up and pin the SDK and its provider
authentication in your application, then run step 5; see the
[SDK MCP guide](https://code.claude.com/docs/en/agent-sdk/mcp).

### Pi

After steps 1–3, create `~/.pi/agent/extensions/wiki.ts`:

```typescript
import wiki from "/opt/agent-wiki/scripts/pi-extension.mjs";
export default function (pi) {
  wiki(pi, {
    command: "/absolute/path/to/node",
    args: [
      "/opt/agent-wiki/scripts/agent-mcp.mjs",
      "/home/you/.config/agent-wiki/researcher.json",
    ],
  });
}
```

Install the engine's locked dependencies with `npm ci`. Start normal `pi`, or use
`/reload` in an existing session. The extension discovers tools at session startup,
converts dots in tool names to underscores, supplies MCP instructions to each model
turn, propagates cancellation and tool errors, and closes the adapter at shutdown.
Protected resource links remain tool content; no credentials enter model results.
Connection failures show a notification and require reload after repair.
[Pi's extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
describes global discovery and lifecycle hooks.

Optional real-model acceptance, using disposable synthetic content only:

```sh
node scripts/verify-pi.mjs --run
```

This uses the local Pi account and configured model/thinking settings, consumes
model usage, and tests global extension discovery, article/trace search and read,
article creation/read-back, and run closure. It requires an existing Pi login.

## 5. Verify tool use from the runtime

The adapter's `--check` verifies credentials and discovery, not whether the model
can use the tools. In a fresh runtime session, ask:

> Use the wiki tools to search for a known article and read it. Then search the
> conversation traces for a known topic and read a matching trace. Report the
> source links. Do not substitute browser or shell access for the wiki tools.

Choose article and trace terms that exist in your installation. Inspect the runtime
transcript: all four operations must complete through the wiki tools. An empty
search can be valid, but does not verify reading a result. End the session normally;
a later session should start a new run. Do not infer success solely from the
model's final statement or an MCP connection status.

Before declaring a new runtime integration production-ready, also exercise errors,
large results, cancellation, token renewal, shutdown/restart, expiry, and revocation
against synthetic content. Editor qualification additionally needs revision-conflict
and unchanged-operation retry checks. The full acceptance boundary is in the
[runtime research](agent-runtime-research.md#recommendation-and-acceptance-boundary).

## Add another agent without sharing its identity

To create another named agent, repeat key generation and registration with a new
filename and name. Launch its runtime with that connection file. For example, a
separate Codex process can select it without changing the default connection:

```sh
codex -c 'mcp_servers.wiki.args=["/opt/agent-wiki/scripts/agent-mcp.mjs","/home/you/.config/agent-wiki/librarian.json"]'
```

Multiple processes using one file are separate runs of the **same principal**.
Subagents that inherit their parent's MCP connection also share that connection's
principal/run; naming a subagent does not provision credentials. Use separate
runtime connections when separate identities or authority are required. Installing
two differently privileged connections in one runtime makes both available to it;
that is not isolation between agents.

## Troubleshooting setup

| Symptom                                           | Check next                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter will not start                            | Use absolute paths, Node 24.19+, and `npm ci` in the installed engine checkout. Run `--check` directly to see its error.                                    |
| Key-file permission error                         | The private key must be a regular file owned by the runtime user with mode 0600. Confirm the connection points to the intended key.                         |
| Authentication fails                              | Confirm the public file was registered in the correct control database, the canonical HTTPS origin matches, and the key/delegation is active and unexpired. |
| Authentication works but an operation is denied   | Check the registered role, requested scopes, and current grants or delegation. Ownership alone does not grant access.                                       |
| `--check` works but the runtime has no wiki tools | Check that runtime's configuration and trust/permission settings; start a fresh session. Pi requires an extension.                                          |
| Two named agents appear as one wiki identity      | They are using the same registration or an inherited connection. Generate and enroll distinct credentials.                                                  |
| A long session stops working                      | Check the 24-hour run limit and registration/delegation expiry. Token renewal does not extend these limits.                                                 |

Do not solve authentication failures by pasting a browser cookie, private key, or
bearer token into a prompt. Inspect configuration and public identity records;
keep secrets out of diagnostic logs.

## Rotation, suspension, and definition updates

Generate a fresh key with a new filename and the existing agent ID:

```sh
node scripts/agent-keygen.mjs /home/you/.config/agent-wiki/researcher-next.json \
  --origin https://wiki.example.org --name 'Researcher' --agent AGENT-UUID
```

Preserve the existing definition if it was customized, register the new public file
under the same owner and intended role/mode, verify it, and update the runtime's
connection path. Then revoke the old key on the server:

```sh
WIKI_CONTROL=/var/lib/wiki/control.sqlite3 node scripts/agent-admin.mjs revoke-key AGENT-UUID OLD-KEY-UUID
```

Revocation immediately rejects tokens and runs authenticated by that key. A revoked
or expired key cannot be restored by replaying its original registration. Rotate it.
Other keys and agents remain independent. To suspend the principal entirely:

```sh
WIKI_CONTROL=/var/lib/wiki/control.sqlite3 node scripts/agent-admin.mjs suspend AGENT-UUID --owner HUMAN-PRINCIPAL-ID
```

To version the stored instructions and advertised MCP tools, write a JSON file with
`instructions` and `tools`, then run:

```sh
WIKI_CONTROL=/var/lib/wiki/control.sqlite3 node scripts/agent-admin.mjs configure AGENT-UUID /tmp/definition.json --owner HUMAN-PRINCIPAL-ID
```

Existing runs keep their recorded definition; new runs use the new version. The
advertised tool list configures MCP discovery/invocation. HTTP authorization still
comes from the run's scopes and current grants; the list is not an extra HTTP ACL.

## Protocol, lifecycle, and limits

- `GET /.well-known/oauth-protected-resource/mcp` advertises the wiki audience.
- `GET /.well-known/oauth-authorization-server` advertises the registered
  `client_credentials` / `private_key_jwt` flow at `POST /oauth/token`.
- This adapter uses the machine-to-machine flow. The same server also supports
  [interactive authorization-code/refresh-token login and dynamic client registration](remote-agents.md).
  Arbitrary ChatGPT OAuth onboarding remains unqualified.
- Signed assertions expire within 60 seconds and have replay-checked IDs. The
  assertion audience is the exact metadata issuer; the requested resource and
  token audience are the exact canonical wiki `/mcp` URL.
- Each adapter process starts one run, lasting at most 24 hours and never beyond
  its registration/delegation expiry. It does not silently start a replacement
  run after expiry or revocation; restart or reauthorize explicitly.
- Five-minute access tokens are stored only as digests. Renewal preserves the
  same run and scope. The adapter serializes renewal and retries a 401 once under
  that same authority. HTTP redirects and other credential destinations are refused.
- `GET /api/agent/run` returns the authenticated run's identity and scope;
  `DELETE /api/agent/run` stops only that run. Adapter shutdown attempts this
  cleanup. Abruptly terminated runs expire automatically.
- Current identity, key, run, delegation, and grants are checked on access and
  before returning asynchronous results. The writer rechecks under the Git lock
  and an immediate control-store transaction before publishing. Verified source
  quotations additionally require trace scope.
- Edit receipts bind actor, run, subject, authority mode, definition, and token
  scope. Renewing a token preserves retry identity; switching run/authority does
  not reuse another run's receipt. Caller-supplied identity fields grant nothing.
- Agent tokens do not authorize human account controls, sign-in, or access
  management. Invalid bearer credentials never fall back to a valid browser cookie.
- Limits: 100 active tokens and 100 active runs per agent, 10,000 active tokens
  overall, 1,000 token-endpoint requests per socket source per 15 minutes, and
  16 KiB token request bodies. Expired token/assertion rows are cleaned during
  issuance. Run and lifecycle audit records are retained.

Back up the authoritative control database consistently along with content and
traces. On disaster recovery, revoke restored agent keys/runs before reopening if
restoring old revocations would be unsafe. Losing the database is not an index
repair: it loses registered identities, permissions, and revocation state.

## Standalone authorization

Agent identity, permissions and revocation belong to the wiki. No external agent
authority, runtime, or shared database is required. See [the source reset](upgrading.md)
for the 0.5.0 public history.

## Persistent credentials for trusted machines

An operator can explicitly enroll an **independent** machine credential until
revocation. Generate a separate key on each trusted machine; retain the private
key there and transfer only its public registration to the Wiki operator:

```sh
node scripts/agent-keygen.mjs /absolute/machine.json \
  --origin https://wiki.example.org --name "Trusted workstation" \
  --role editor --until-revoked
```

Register it using the same operator procedure above with `--mode independent`.
The public registration uses `expiresAt: null`; omitted or malformed expiration
is rejected. Delegated authority always expires. Existing registrations retain
their expiration and cannot be changed in place; rotate to a new key ID.

For Codex versions supporting `http_headers_helper`, configure the native HTTP
connection with an absolute, shell-quoted command:

```toml
[mcp_servers.wiki]
url = "https://wiki.example.org/mcp"
http_headers_helper = "'/absolute/node' '/absolute/agent-wiki/scripts/agent-headers.mjs' '/absolute/machine.json'"
required = true
startup_timeout_sec = 45
```

Run `codex mcp logout wiki` once when migrating an existing OAuth connection:
stored OAuth takes precedence over a helper-provided Authorization header.
Reload the MCP connection in existing Codex sessions after changing configuration.
Do not run browser OAuth login for a helper-managed connection. Keep the URL
and server name unchanged so tool references remain stable.

The helper signs a fresh, one-use assertion and returns only a five-minute bearer
header. Each invocation has a distinct run, bounded to five minutes by the signed
`wiki_run_duration` claim (allowed range 60–86400 seconds; the existing default is
24 hours). Codex caches the header per connection and refreshes it after a
same-origin POST receives 401/403. It never shares a rotating refresh token
between processes. Expired short runs do not consume the active-run quota.
Edit retries for persistent credentials bind the operation ID to the registered
key and current authority across runs; receipts retain the original run for
attribution. Existing expiring credentials keep their earlier receipt identity.

No private key or bearer token is written into Codex configuration. The enrollment
does not expire, but access still checks the active key, principal, owner/invoke
permission, current role, run and requested scope on every operation. Revoking
one key immediately rejects its existing tokens and future helper invocations.
Stopping one short run stops that token; revoke the key to deauthorize the
machine. Permission and revocation failures are never silently re-enrolled.
Keep recovery and explicit key rotation in the operator's deployment system.

Check authentication and required tool discovery without printing credentials:

```sh
node scripts/agent-headers.mjs /absolute/machine.json --check
```

`required = true` makes a connection failure visible at startup. Network, server,
filesystem and deliberate revocation failures can still interrupt access; a
persistent enrollment removes scheduled login expiry, not those dependencies.

### Evidence boundary in 0.6.0

Reader grants no longer allow trace evidence. Use `wiki:read` for article-only
clients. Existing editorial clients need an editor grant and explicit `wiki:trace`
scope; WIKI_WRITE can remain disabled. Revocation is checked on every request.
See [upgrade notes](upgrading.md) and [interface coverage](interfaces.md).
