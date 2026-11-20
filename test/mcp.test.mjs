import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { connectAgent } from "../src/agent-client.mjs";
import { AgentStore } from "../src/agent-store.mjs";
import { ControlStore, digest } from "../src/control-store.mjs";
import { git, markdown } from "../src/git-wiki.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const largeBody = "Complete article content. ".repeat(48000) + "\n";

function value(result) {
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content.find((item) => item.type === "text").text);
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-mcp-test-"));
  let control, child;
  t.after(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await stopped;
      }
    } finally {
      control?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  const repo = path.join(directory, "content");
  fs.mkdirSync(path.join(repo, "wiki"), { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "MCP integration test"]);
  git(repo, ["config", "user.email", "mcp-test@example.invalid"]);
  for (const [id, body] of [
    ["hello", "Hello from the integration fixture.\n"],
    ["large", largeBody],
  ]) {
    fs.writeFileSync(
      path.join(repo, "wiki", `${id}.md`),
      markdown(
        { title: id, description: `${id} article`, topic: "Tests" },
        body,
      ),
    );
  }
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "Seed integration wiki"]);
  control = new ControlStore(path.join(directory, "control.sqlite3"));
  const owner = control.bootstrap({
    issuer: "urn:mcp-test",
    subject: "owner",
    name: "Test owner",
  });
  const agents = new AgentStore(control);
  child = fork(
    new URL("./fixtures/mcp-server.mjs", import.meta.url),
    [repo, control.filename],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  function event(kind, query) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${kind}: ${output}`));
      }, 10000);
      const cleanup = () => {
        clearTimeout(timeout);
        child.off("message", message);
        child.off("exit", exit);
        child.off("error", error);
      };
      const error = (cause) => {
        cleanup();
        reject(cause);
      };
      const exit = () => error(new Error(`Wiki exited: ${output}`));
      const message = (data) => {
        if (data.event === kind && data.query === query) {
          cleanup();
          resolve(data);
        }
      };
      child.on("message", message);
      child.on("exit", exit);
      child.on("error", error);
    });
  }
  const { origin } = await event("ready");

  function enroll(role = "editor") {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const agent = randomUUID();
    const key = randomUUID();
    const actions = role === "reader" ? ["read"] : ["read", "write", "trace"];
    // Include writes in the definition even for a reader: authorization must
    // filter them independently of the agent's requested tool catalog.
    agents.enrollOperator(
      {
        version: 1,
        agent,
        key,
        name: `Integration ${role}`,
        publicKey: { ...publicKey.export({ format: "jwk" }), alg: "RS256" },
        expiresAt: null,
        scope: [{ space: "default", actions }],
        definition: {
          instructions: "Use the disposable integration wiki.",
          tools: [
            "wiki.search",
            "wiki.read",
            "wiki.history",
            "wiki.save",
            "wiki.edit",
            "wiki.delete",
            "wiki.traceSearch",
          ],
        },
      },
      owner,
      role,
    );
    const privateKeyFile = path.join(directory, `${agent}.pem`);
    fs.writeFileSync(
      privateKeyFile,
      privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    const config = {
      version: 1,
      endpoint: `${origin}/mcp`,
      agent,
      key,
      privateKeyFile,
      scope: actions.map((action) => `wiki:${action}`).join(" "),
    };
    const filename = path.join(directory, `${agent}.json`);
    fs.writeFileSync(filename, JSON.stringify(config));
    return { config, filename };
  }

  async function connect(t, role = "editor", stdio = false, options = {}) {
    const { config, filename } = enroll(role);
    if (!stdio) {
      const connection = await connectAgent(config, options);
      t.after(() => connection.close());
      return { ...connection, config };
    }
    fs.writeFileSync(filename, JSON.stringify({ ...config, ...options }));
    const client = new Client({ name: "wiki-integration", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "scripts/agent-mcp.mjs"), filename],
      stderr: "pipe",
    });
    t.after(() => client.close());
    await client.connect(transport);
    return { client, config };
  }

  async function request(token, pathname, options = {}) {
    return fetch(origin + pathname, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
      signal: AbortSignal.timeout(10000),
    });
  }
  return { repo, control, agents, child, origin, connect, event, request };
}

test("MCP integration", { timeout: 90000 }, async (t) => {
  const f = await fixture(t);

  for (const stdio of [false, true]) {
    const transport = stdio ? "stdio bridge" : "HTTP";
    await t.test(
      `${transport}: authenticated discovery, search and read`,
      async (t) => {
        const { client } = await f.connect(t, "editor", stdio);
        const { tools } = await client.listTools();
        assert.ok(tools.some(({ name }) => name === "wiki.save"));
        const search = value(
          await client.callTool({
            name: "wiki.search",
            arguments: { q: "Hello" },
          }),
        );
        assert.match(JSON.stringify(search), /hello/);
        const article = value(
          await client.callTool({
            name: "wiki.read",
            arguments: { id: "hello" },
          }),
        );
        assert.match(
          JSON.stringify(article),
          /Hello from the integration fixture/,
        );
      },
    );
  }

  await t.test(
    "auto negotiation falls back to a legacy-only peer",
    async (t) => {
      let probes = 0,
        legacyCalls = 0;
      const { client } = await f.connect(t, "reader", false, {
        fetch(input, init) {
          const message =
            new URL(input).pathname === "/mcp" && init.body
              ? JSON.parse(init.body)
              : null;
          // An older peer does not implement modern discovery. All other
          // traffic still passes through the real wiki and its authorization.
          if (message?.method === "server/discover") {
            probes++;
            return Promise.resolve(
              Response.json(
                {
                  jsonrpc: "2.0",
                  id: message.id,
                  error: { code: -32601, message: "Method not found" },
                },
                { status: 404 },
              ),
            );
          }
          if (message?.method === "initialize") legacyCalls++;
          return fetch(input, init);
        },
      });
      assert.equal(probes, 1);
      assert.equal(legacyCalls, 1);
      assert.equal(
        value(
          await client.callTool({
            name: "wiki.read",
            arguments: { id: "hello" },
          }),
        ).id,
        "hello",
      );
    },
  );

  await t.test("reader cannot discover or invoke writes", async (t) => {
    const { client, credential } = await f.connect(t, "reader");
    const { tools } = await client.listTools();
    for (const name of [
      "wiki.save",
      "wiki.edit",
      "wiki.delete",
      "wiki.traceSearch",
    ])
      assert.ok(!tools.some((tool) => tool.name === name), name);
    const head = git(f.repo, ["rev-parse", "HEAD"]);
    await assert.rejects(
      client.callTool({ name: "wiki.save", arguments: {} }),
      { code: -32602, message: /Tool wiki.save not found/ },
    );
    const response = await f.request(
      credential.accessToken,
      "/api/articles/edits",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wiki-Write": "1" },
        body: JSON.stringify({ operation_id: "reader-write", updates: [] }),
      },
    );
    assert.ok([403, 404].includes(response.status));
    assert.equal(git(f.repo, ["rev-parse", "HEAD"]), head);
  });

  await t.test(
    "save/edit persist, retries are idempotent, stale revisions fail",
    async (t) => {
      const { client } = await f.connect(t);
      const draft = {
        operation_id: "create-article",
        updates: [
          {
            id: "created",
            expected_revision_id: null,
            title: "Created through MCP",
            description: "Integration write",
            topic: "Tests",
            body: "Original content.\n",
            summary: "Create article",
          },
        ],
      };
      const saved = value(
        await client.callTool({ name: "wiki.save", arguments: draft }),
      );
      assert.equal(saved.state, "saved");
      const head = git(f.repo, ["rev-parse", "HEAD"]);
      const retry = value(
        await client.callTool({ name: "wiki.save", arguments: draft }),
      );
      assert.equal(retry.state, "already-saved");
      assert.equal(retry.commit, saved.commit);
      assert.equal(git(f.repo, ["rev-parse", "HEAD"]), head);
      const edit = {
        operation_id: "edit-article",
        id: "created",
        expected_revision_id: saved.articles[0].revision_id,
        summary: "Edit article",
        edits: [
          { old_text: "Original content.", new_text: "Updated content." },
        ],
      };
      value(await client.callTool({ name: "wiki.edit", arguments: edit }));
      const editedHead = git(f.repo, ["rev-parse", "HEAD"]);
      assert.equal(
        value(await client.callTool({ name: "wiki.edit", arguments: edit }))
          .state,
        "already-saved",
      );
      assert.equal(git(f.repo, ["rev-parse", "HEAD"]), editedHead);
      const stale = await client.callTool({
        name: "wiki.save",
        arguments: {
          operation_id: "stale-write",
          updates: [
            {
              ...draft.updates[0],
              expected_revision_id: saved.articles[0].revision_id,
            },
          ],
        },
      });
      assert.equal(stale.isError, true);
      assert.equal(JSON.parse(stale.content[0].text).code, "REVISION_CONFLICT");
      assert.equal(git(f.repo, ["rev-parse", "HEAD"]), editedHead);
      assert.match(
        git(f.repo, ["show", "HEAD:wiki/created.md"]),
        /Updated content\./,
      );
    },
  );

  await t.test(
    "expired access token renews without changing the run",
    async (t) => {
      const { client, credential } = await f.connect(t);
      const oldToken = credential.accessToken;
      const run = credential.run;
      // Expire the server-side token while the client still has it cached,
      // exercising the transport's 401 retry rather than directly calling renew.
      f.control.db
        .prepare("UPDATE agent_tokens SET expires=? WHERE hash=?")
        .run(Date.now() - 1000, digest(oldToken));
      assert.equal(
        (await f.request(oldToken, "/api/articles/hello/current.json")).status,
        401,
      );
      value(
        await client.callTool({
          name: "wiki.read",
          arguments: { id: "hello" },
        }),
      );
      assert.notEqual(credential.accessToken, oldToken);
      assert.equal(credential.run, run);
      assert.equal(
        f.control.db
          .prepare("SELECT count(*) AS n FROM agent_runs WHERE agent=?")
          .get(credential.config.agent).n,
        1,
      );
    },
  );

  await t.test(
    "revoked keys and expired runs cannot read or renew",
    async (t) => {
      for (const revoke of [true, false]) {
        const { client, credential, config } = await f.connect(t);
        if (revoke) f.agents.revokeKey(config.agent, config.key);
        else
          f.control.db
            .prepare("UPDATE agent_runs SET expires=? WHERE id=?")
            .run(Date.now() - 1000, credential.run);
        assert.equal(
          (
            await f.request(
              credential.accessToken,
              "/api/articles/hello/current.json",
            )
          ).status,
          401,
        );
        await assert.rejects(
          client.callTool({ name: "wiki.read", arguments: { id: "hello" } }),
        );
      }
    },
  );

  await t.test(
    "oversized and malformed requests fail without poisoning the connection",
    async (t) => {
      const { client, credential } = await f.connect(t);
      for (const [body, status] of [
        [" ".repeat(512001), 413],
        ["{", 400],
      ]) {
        const response = await f.request(credential.accessToken, "/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body,
        });
        assert.equal(response.status, status);
        await response.text();
      }
      value(
        await client.callTool({
          name: "wiki.read",
          arguments: { id: "hello" },
        }),
      );
    },
  );

  await t.test(
    "large results return a complete, protected resource link",
    async (t) => {
      const { client, credential, config } = await f.connect(t, "reader");
      const result = await client.callTool({
        name: "wiki.read",
        arguments: { id: "large" },
      });
      assert.ok(!result.isError);
      const resource = result.content.find(
        (item) => item.type === "resource_link",
      );
      assert.ok(resource, JSON.stringify(result));
      assert.equal(new URL(resource.uri).origin, f.origin);
      const pathname =
        new URL(resource.uri).pathname + new URL(resource.uri).search;
      const response = await f.request(credential.accessToken, pathname);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).body, largeBody);
      const anonymous = await fetch(resource.uri, { redirect: "manual" });
      assert.ok(anonymous.status >= 300);
      await anonymous.text();
      f.agents.revokeKey(config.agent, config.key);
      assert.equal(
        (await f.request(credential.accessToken, pathname)).status,
        401,
      );
    },
  );

  for (const stdio of [false, true]) {
    await t.test(
      `${stdio ? "stdio bridge" : "HTTP"}: cancellation stops only its backend request`,
      async (t) => {
        const { client } = await f.connect(t, "editor", stdio);
        const query = `blocked-${stdio ? "stdio" : "http"}`;
        const abort = new AbortController();
        const started = f.event("started", query);
        const cancelled = f.event("cancelled", query);
        const siblingQuery = `${query}-sibling`;
        const siblingStarted = f.event("started", siblingQuery);
        const sibling = client.callTool({
          name: "wiki.traceSearch",
          arguments: { q: siblingQuery },
        });
        const request = client.callTool(
          { name: "wiki.traceSearch", arguments: { q: query } },
          { signal: abort.signal },
        );
        const rejected = assert.rejects(request);
        await Promise.all([started, siblingStarted]);
        abort.abort();
        await rejected;
        await cancelled;
        f.child.send({ release: siblingQuery });
        assert.deepEqual(value(await sibling), { results: [] });
        value(
          await client.callTool({
            name: "wiki.read",
            arguments: { id: "hello" },
          }),
        );
      },
    );
  }

  await t.test(
    "stdio adapter timeout cancels its backend request",
    async (t) => {
      const { client } = await f.connect(t, "editor", true, {
        requestTimeoutMs: 500,
      });
      const query = "blocked-timeout";
      const started = f.event("started", query);
      const cancelled = f.event("cancelled", query);
      const request = client.callTool({
        name: "wiki.traceSearch",
        arguments: { q: query },
      });
      await started;
      const result = await request;
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /timed out|timeout/i);
      await cancelled;
    },
  );
});
