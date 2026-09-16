# From an example to your own wiki

This walkthrough connects a local Codex CLI client to fictional project knowledge,
follows a claim to its source, and saves an edit you can inspect in Git. Everything
in the example is synthetic. You can also complete the browser steps without an
agent account.

For a private authenticated installation, follow [Remote agent connections](remote-agents.md)
instead of the unauthenticated loopback connection below.

## Start the example

Use Linux or macOS with Node 24.19+ and Git. These commands use public `main`, which
may be newer than the latest tagged release. For an exact released version, see
[releases](https://github.com/dispatchlabs-ai/agent-wiki/releases).

```sh
git clone https://github.com/dispatchlabs-ai/agent-wiki.git
cd agent-wiki
npm ci
npm run example
```

Keep this terminal running. Open <http://127.0.0.1:4317> on the same machine.
The server creates `.runtime/example`, a separate Git repository containing three
fictional articles, and imports the two bundled conversation snapshots. It enables
local editing and never pushes. Your example edits survive a restart.

## Follow a claim to its evidence

Open **Atlas Labs**. Its Current work section describes a two-week prototype with
Cedar Instruments, reviewed by Morgan Vale. Select **recorded decision** to reach
the original Codex answer at `line-8`. Return to the article and select **prototype
plan** to reach the pi answer at `line-5`, which names Morgan as the reviewer.
The article's **Sources** tab also links to these passages.

![The synthetic Atlas Labs article and its evidence links](assets/atlas-labs-desktop.png)

The distinction matters: the article is a maintained explanation; the trace is the
original record behind it. A citation gives you a way to check a claim, rather than
making the claim automatically true.

## Connect Codex CLI

Install and sign in to [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) if you
want to use an agent. The wiki itself has no model requirement; Codex uses your
own account and its normal usage limits. Run the client on the same machine as
the example. A hosted client cannot reach your computer's loopback address.

In a second terminal, start Codex with a setting for this invocation only:

```sh
codex -c 'mcp_servers.agent_wiki.url="http://127.0.0.1:4317/mcp"'
```

Use `/mcp` to inspect the connection. This uses regular MCP over Streamable HTTP;
no browser integration or WebMCP experimental flag is required. The command does
not add a permanent server to your user configuration. See the
[official MCP configuration reference](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
for persistent configuration and client approval settings.

Ask:

> Use the agent_wiki tools to search for Atlas Labs and read its article. Follow
> its original conversation citations. What is the prototype duration, and who
> reviews it? Cite the source passage. Do not change any articles.

Expect **two weeks** and **Morgan Vale**, supported by the bundled pi source at
`http://127.0.0.1:4317/traces/1becc1c6b6aff33213fee188a377c98641a4d78146ebd6f0ea7b9e7720709ce7/?page=1#line-5`.
The answer's citation should be a complete URL you can open outside the wiki.
MCP supplies the configured wiki origin for resolving article and source links.
The wording of the answer can vary. The tool activity should include a search,
an article read, and a trace read; an answer from the article alone has not checked
the original evidence.

Then ask:

> Use wiki.preview to preview this Markdown without saving it:
> Tutorial note: Morgan reviews the two-week prototype.

### Compatibility checked

On September 16, 2026, Codex CLI **0.154.0** on Linux with Node **26.8.1** completed
MCP discovery, article search/read, original trace reading and unsaved preview
against this source with the citation-origin fix. The test used the temporary
command-line MCP URL override above, with a free loopback port. Its answer linked
directly to the original passage, which was opened and checked in a browser.
Example Git history remained unchanged. Agent-driven saving was not part of this
run; the browser save below and the official MCP SDK's save/retry/conflict tests
are separately tested. See the [verification record](onboarding-verification.md)
for scope and earlier runs. Other clients and remote authentication setups need
their own checks; protocol support alone is not a compatibility claim.

## Save and inspect a revision

In the browser, return to Atlas Labs and choose **Edit article**. Keep the existing
text, append the tutorial note above, and enter **Record the tutorial review note**
as the change summary. Preview, then save.

Open **History** and compare the new revision with its predecessor. A fresh example
advances from revision 1 to 2; a previously edited example can have higher numbers.
The current article should contain the note and retain both original citations.
From the engine checkout, inspect the corresponding Git change:

```sh
git -C .runtime/example log -1 --oneline
git -C .runtime/example show HEAD -- wiki/atlas-labs.md
```

Stop the server with Ctrl-C, restart `npm run example`, and read the article again.
The saved note remains; `examples/wiki/atlas-labs.md` is unchanged.

An agent can also save through `wiki.save` when the server exposes it and the
client permits the call. It must first read the current revision, preserve the
existing article, and use a fresh operation ID. Do not blindly retry a conflict
with a new revision ID; reconcile the text. For an ambiguous save response, retry
the identical request with the same operation ID. See the
[save contract](api.md#save-an-article) for the request and receipt fields.

## Start a personal content repository

Stop the example. From the engine checkout, create a separate content repository.
Choose a new destination if `../my-wiki-content` already exists. Replace the Git
author values with your own before running these commands:

```sh
mkdir ../my-wiki-content
git -C ../my-wiki-content init -b main
git -C ../my-wiki-content config user.name "Your Name"
git -C ../my-wiki-content config user.email "you@example.com"
mkdir ../my-wiki-content/wiki
cat > ../my-wiki-content/wiki/welcome.md <<'MARKDOWN'
---
title: Welcome
description: The starting point for my project knowledge.
topic: Projects
---

This is my first article. Add a sourced explanation of a project here.
MARKDOWN
git -C ../my-wiki-content add wiki
git -C ../my-wiki-content commit -m "Add first article"
```

### Configure authenticated hosting

The example launcher above is only for synthetic content. `npm start` always
requires a private control database and authenticated hosting, even for read-only
content. An unauthenticated example MCP connection cannot be reused here.

Before starting, choose your real HTTPS hostname and configure a reverse proxy to
forward it to `127.0.0.1:4317`, preserving the Host header. The proxy must run on
the same machine or use a separately secured connection. You supply DNS and a
trusted TLS certificate; the wiki does not provision them. Do not expose port
4317 directly. Replace `wiki.example.org` below with that hostname.

In the engine checkout, create a new private directory for authentication state.
Choose another name if `../my-wiki-state` already exists. Use the same shell for
bootstrap and server startup so the exported settings are retained:

```sh
mkdir -m 700 ../my-wiki-state
export WIKI_CONTROL="$(cd ../my-wiki-state && pwd)/control.sqlite3"
export WIKI_REPO="$(cd ../my-wiki-content && pwd)"
export WIKI_ORIGIN=https://wiki.example.org
export PORT=4317
export WIKI_LOCAL_LOGIN=1
export WIKI_WRITE=0 WIKI_PUSH=0 WIKI_DATABASE=:memory:
export WIKI_TRACES= WIKI_EVIDENCE_URL=
unset WIKI_GOOGLE_CLIENT_ID WIKI_GOOGLE_CLIENT_SECRET
unset WIKI_OIDC_ISSUER WIKI_OIDC_CLIENT_ID WIKI_OIDC_CLIENT_SECRET
node scripts/local-account.mjs bootstrap manager@example.org 'Initial manager'
npm start
```

Replace the manager email with your own. The bootstrap command prints a private,
single-use setup URL. Open it through your configured HTTPS hostname and choose
an initial password of at least 15 characters. Keep the URL out of shared logs
and Git. Bootstrap is for an empty control store; do not rerun it at every start.
Read **Welcome** in the browser after account setup. A fresh signed-out browser
must see sign-in rather than the article.

To enable editing, restart the server with `WIKI_WRITE=1`; manager/editor grants
are still required. Content changes are committed locally, and `WIKI_PUSH=0`
prevents automatic pushes. Ordinary file edits appear only after commit; pause
server writing while making direct Git edits.

For agent access, follow [remote OAuth connections](remote-agents.md) to create
and permit an agent, then connect the HTTPS MCP endpoint and complete consent.
Alternatively use the [operator signing-key guide](agent-setup.md). Never copy a
browser cookie into the client. Verify article reads and that read-only discovery
omits `wiki.save`; reconnect after changing server write settings.

Back up the complete content repository, including `.git`. The index is disposable;
the Git history and operation receipts are not. See [content format](../README.md#content-format),
[trace import](traces.md), and [recovery](api.md#git-correctness-and-recovery) when needed.

## Troubleshooting

| Symptom                   | Next step                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:sqlite` cannot load | Check `node --version`; use a supported runtime (Node 24.19+).                                                                                 |
| `EADDRINUSE`              | Stop your other example, or run `PORT=4318 npm run example` and use port 4318 in both browser and MCP URL.                                     |
| `Invalid host`            | Use `127.0.0.1`, not `localhost`, for the default example; clear an inherited `WIKI_ORIGIN` or use its exact configured host.                  |
| MCP cannot connect        | Keep the server running on the client's machine; check its URL ends with `/mcp` and inspect `/mcp` in Codex.                                   |
| Save tool is absent       | Normal instances are read-only unless `WIKI_WRITE=1`; reconnect the client after changing server settings.                                     |
| Save requires approval    | Approve through your client's normal interactive flow. A noninteractive client can reject writes; use the browser editor for this walkthrough. |
| Old example edits remain  | This is intentional. Startup preserves `.runtime/example`; it does not reset your work.                                                        |

For remote use, supply HTTPS and access control at a reverse proxy, including on
`/mcp`. Browser login cookies do not automatically authenticate an MCP client.
The standalone server supports [remote OAuth connections](remote-agents.md):
add its HTTPS MCP endpoint, sign in, and choose a permitted agent. The client
receives its own revocable credentials; do not copy browser session cookies.
Do not expose the editable example as a public demo. See [security](../SECURITY.md).

## Authenticated remote clients

For shared hosting, prefer [remote agent connections](remote-agents.md): add the
HTTPS MCP endpoint, sign in, and select an explicitly permitted agent. The signing-key
adapter remains available for unattended operators. The loopback example workflow
uses synthetic content and is not an authenticated hosting configuration.
