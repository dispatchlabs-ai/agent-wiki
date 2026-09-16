# First useful workflow with an agent

Run a synthetic local wiki, obtain an answer backed by its original conversation,
and preview a note without modifying any articles. You need terminal/process access,
Git, Node 24.19+ and npm on Linux or macOS. Use your existing model account; the wiki
contains no model. This downloads public dependencies and creates only a new local
checkout and its disposable example state. Do not read private content or change
persistent client settings. Do not publish the editable example to a network.

## Start a clean example

Choose a new directory. If the default destination already exists, choose another;
do not overwrite it. Clone `https://github.com/dispatchlabs-ai/agent-wiki.git`, run
`npm ci` in the clone, then run `npm run example` as a foreground process you can
keep alive while using the wiki. Use a process session or your terminal's process
management. Report if your environment cannot keep it running.

The default URL is `http://127.0.0.1:4317`. If occupied, choose a free port and set
both `PORT` and `WIKI_ORIGIN=http://127.0.0.1:PORT` for the example. Do not stop an
unrelated listener. Clear inherited `WIKI_DATABASE` and `WIKI_ORIGIN` unless you
are explicitly setting the new example's own origin and disposable index.
The launcher isolates private content, trace providers and push settings. All
shipped examples are fictional.

Wait for `/healthz` to return `{ "status": "ok" }`. Add the URL's `/mcp` endpoint
only to the current agent session, if your client supports that. The
[manual walkthrough](getting-started.md#connect-codex-cli) gives a temporary Codex
CLI override. Never edit a global client configuration for this trial.

If you cannot attach tools during the current session, use the installed official
MCP SDK through a temporary script in the clone, or clearly report that you could
not exercise MCP. The SDK classes are `Client` and `StreamableHTTPClientTransport`, both exported
from `@modelcontextprotocol/client`. Connect, call `listTools()`, then
`callTool({ name, arguments })`; follow the returned tool schemas. Close the client
when finished. Do not substitute guessed HTTP routes for an MCP verification.

## Follow evidence and preview

1. Discover the tools and use `wiki.search` to find Atlas Labs.
2. Read its article with `wiki.read`, follow the original conversation citations,
   and use the available trace tools to inspect the cited source passage.
3. Answer: how long is the prototype, and who reviews it? Include a link to the
   original passage, rather than citing only the maintained article.
4. Use `wiki.preview` for this Markdown: `Tutorial note: Morgan reviews the two-week prototype.`
   Verify rendered output. Do not call `wiki.save`.
5. Report discovery, search, article read, source read and preview separately.
   State any blocked steps. Provide the browser URL and explain how to stop the
   example. Leave it running for the user when your environment supports that.

The expected answer is **two weeks**, reviewed by **Morgan Vale**. The pi trace's
`line-5` is an original supporting passage; discover its link through the article.
The example creates `.runtime/example` and a trace import under `.runtime/` in
this new checkout. There is no real-account setup, credential provisioning,
provider login or private data required. The separate
[authenticated setup](getting-started.md#start-a-personal-content-repository)
is required before using your own content.
