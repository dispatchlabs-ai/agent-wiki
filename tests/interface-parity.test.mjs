import { fromJsonSchema } from "@modelcontextprotocol/server";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { ControlStore } from "../src/control-store.mjs";
import { AgentStore } from "../src/agent-store.mjs";
import { RemoteAgents } from "../src/remote-agents.mjs";
import { hashPassword } from "../src/passwords.mjs";
import { createWiki } from "../src/server.mjs";
import {
  WikiApiClient,
  readPrivateJSON,
  writeProfile,
} from "../src/api-client.mjs";
import { browserLogin } from "../src/cli-login.mjs";
import { createWikiTools } from "../public/wiki-tools.js";
import { openAPI, operations } from "../src/api-contract.mjs";
import { fixture, update } from "./helpers.mjs";
import { evidenceFixture, evidenceId, fileId } from "./evidence-fixture.mjs";

const engine = fileURLToPath(new URL("../", import.meta.url));
async function setup(t) {
  const repo = fixture(t),
    control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  const portServer = createServer();
  let app, evidence;
  t.after(async () => {
    if (app) {
      await new Promise((resolve) => {
        app.close(resolve);
        app.closeAllConnections();
      });
    }
    await new Promise((resolve) => portServer.close(resolve));
    control.close();
    await evidence?.close();
  });
  const owner = control.bootstrap({
    issuer: "https://id.example",
    subject: "owner",
    name: "Owner",
  });
  const invitation = control.inviteLocal(
    owner,
    "editor@example.invalid",
    "Editor",
  );
  const password = "synthetic interface test password";
  control.acceptInvitation(invitation.token, await hashPassword(password));
  control.grant(owner, invitation.id, "editor");
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const origin = `http://127.0.0.1:${portServer.address().port}`;
  evidence = await evidenceFixture();
  app = createWiki({
    repo,
    origin,
    control,
    write: true,
    localLogin: true,
    development: true,
    evidenceUrl: evidence.url,
  });
  // Adopt the bound listener without releasing its port during setup.
  app.listen(portServer);
  await once(app, "listening");
  const config = path.join(repo, ".git/cli.json");
  const cli = (args, input = "") =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["bin/wiki.mjs", ...args, "--json", "--config", config],
        { cwd: engine, stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (b) => {
        out += b;
      });
      child.stderr.on("data", (b) => {
        err += b;
      });
      child.on("error", reject);
      child.stdin.end(input);
      child.on("close", (code) => {
        try {
          resolve({ code, result: JSON.parse(out), err, out });
        } catch {
          reject(Error(out + err));
        }
      });
    });
  return {
    repo,
    control,
    owner,
    actor: invitation.id,
    password,
    origin,
    evidence,
    cli,
    config,
  };
}

test("same human gets consistent HTTP, CLI, MCP and WebMCP reads, writes, conflicts and retry receipts", async (t) => {
  const f = await setup(t);
  const login = await f.cli(
    [
      "login",
      "--url",
      f.origin,
      "--email",
      "editor@example.invalid",
      "--password-stdin",
    ],
    f.password + "\n",
  );
  assert.equal(login.code, 0, login.err + login.out);
  assert.equal(login.result.id, f.actor);
  assert.equal(login.result.csrf, undefined);
  assert.doesNotMatch(
    login.out,
    /synthetic interface test password|wiki_session/,
  );
  assert.equal(fs.statSync(f.config).mode & 0o777, 0o600);
  const profile = readPrivateJSON(f.config);
  const api = new WikiApiClient(profile);
  const headers = {
    Cookie: `wiki_session=${profile.session}`,
    "X-Wiki-CSRF": profile.csrf,
    Origin: f.origin,
  };
  const mcp = new Client({ name: "parity", version: "1" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(f.origin + "/mcp"), {
      requestInit: { headers },
    }),
  );
  t.after(() => mcp.close());
  const call = async (name, args) =>
    JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text);
  const webmcp = createWikiTools(
    (route, body) => api.request(route, body),
    true,
    { externalEvidence: true },
  );
  const webcall = (name, args) =>
    webmcp.find((t) => t.name === name).execute(args);
  const validateResponse = async (route, method, value) => {
    const schema =
      openAPI().paths[route][method].responses["200"].content[
        "application/json"
      ].schema;
    const checked = await fromJsonSchema(schema)["~standard"].validate(value);
    assert.equal(checked.issues, undefined, JSON.stringify(checked.issues));
  };
  await validateResponse(
    "/api/articles/catalog.json",
    "get",
    await api.request("/api/articles/catalog.json"),
  );
  const read = await api.request("/api/articles/guide/current.json");
  await validateResponse("/api/articles/{id}/{revision}.json", "get", read);
  assert.deepEqual((await f.cli(["read", "guide"])).result, read);
  assert.deepEqual(await call("wiki.read", { id: "guide" }), read);
  assert.deepEqual(await webcall("wiki.read", { id: "guide" }), read);
  const search = await api.request("/api/articles/search?q=guide");
  await validateResponse("/api/articles/search", "get", search);
  for (const result of [
    (await f.cli(["search", "guide"])).result,
    await call("wiki.search", { q: "guide" }),
    await webcall("wiki.search", { q: "guide" }),
  ])
    assert.deepEqual(result.articles, search.articles);
  const draft = {
    operation_id: "cross-interface-create",
    updates: [update("parity-note", "Published note with [[guide]].")],
  };
  // Simulate an uncertain successful response: discard it and retry through every adapter.
  await api.request("/api/articles/edits", draft);
  const recovered = await f.cli(["save", "--file", "-"], JSON.stringify(draft));
  assert.equal(recovered.code, 0, recovered.out);
  await validateResponse("/api/articles/edits", "post", recovered.result);
  assert.equal(recovered.result.state, "already-saved");
  assert.equal(recovered.result.actor, f.actor);
  for (const result of [
    await call("wiki.save", draft),
    await webcall("wiki.save", draft),
  ])
    assert.equal(result.commit, recovered.result.commit);
  const history = await api.request("/api/articles/parity-note/history.json");
  assert.equal(history.revisions.length, 1);
  assert.deepEqual((await f.cli(["history", "parity-note"])).result, history);
  const stale = { ...draft, operation_id: "cross-interface-stale" };
  assert.equal(
    (await f.cli(["save", "--file", "-"], JSON.stringify(stale))).result.code,
    "REVISION_CONFLICT",
  );
  assert.equal((await call("wiki.save", stale)).code, "REVISION_CONFLICT");
  await assert.rejects(webcall("wiki.save", stale), {
    code: "REVISION_CONFLICT",
  });
  await assert.rejects(api.request("/api/articles/edits", stale), {
    code: "REVISION_CONFLICT",
  });
  const changed = {
    ...draft,
    updates: [update("parity-note", "Changed input.")],
  };
  const conflict = await f.cli(
    ["save", "--file", "-"],
    JSON.stringify(changed),
  );
  assert.equal(conflict.code, 3);
  assert.equal((await call("wiki.save", changed)).code, conflict.result.code);
  const article = (await f.cli(["read", "parity-note"])).result;
  const edited = await f.cli(
    [
      "edit",
      "parity-note",
      "--file",
      "-",
      "--revision",
      article.revision_id,
      "--operation-id",
      "cli-edit",
    ],
    JSON.stringify({
      ...update("ignored", "Changed through CLI."),
      expected_revision_id: "ignored",
    }),
  );
  assert.equal(edited.code, 0, edited.out);
  assert.equal(
    (await f.cli(["history", "parity-note"])).result.revisions.length,
    2,
  );
  assert.equal(
    (
      await f.cli(
        ["create", "cli-note", "--file", "-", "--operation-id", "cli-create"],
        JSON.stringify(update("ignored")),
      )
    ).code,
    0,
  );
  assert.equal((await f.cli(["trace", evidenceId])).code, 0);
  const evidence = await api.request(`/api/files/${fileId}.json`);
  assert.deepEqual((await f.cli(["file", fileId])).result, evidence);
  assert.deepEqual(await call("wiki.file", { asset: fileId }), evidence);
  assert.deepEqual(await webcall("wiki.file", { asset: fileId }), evidence);
  const preview = await f.cli(
    ["preview", "--file", "-"],
    `[citation](/conversations/${evidenceId}/)`,
  );
  assert.equal(preview.code, 0);
  assert.doesNotMatch(preview.out, /Prototype conversation|Captured notes/);
  f.control.grant(f.owner, f.actor, "reader");
  assert.equal((await f.cli(["read", "guide"])).code, 0);
  for (const name of ["wiki.file", "wiki.trace", "wiki.traceSearch"])
    assert.ok(
      !(await mcp.listTools()).tools.some((tool) => tool.name === name),
    );
  for (const route of [
    `/api/files/${fileId}.json`,
    `/api/traces/${evidenceId}.json`,
    "/api/traces/search?q=prototype",
  ])
    await assert.rejects(api.request(route), { status: 404 });
  assert.equal((await f.cli(["file", fileId])).code, 4);
  await assert.rejects(webcall("wiki.file", { asset: fileId }), {
    status: 404,
  });
  assert.equal(
    (await f.cli(["save", "--file", "-"], JSON.stringify(draft))).code,
    4,
  );
  f.control.grant(f.owner, f.actor, null);
  assert.equal((await f.cli(["read", "guide"])).code, 4);
  await assert.rejects(webcall("wiki.read", { id: "guide" }), { status: 404 });
  assert.equal((await f.cli(["logout"])).code, 0);
  assert.equal(f.control.authenticate(profile.session), null);
  assert.equal(fs.existsSync(f.config), false);
});

test("CLI browser OAuth validates state, selects explicit agent authority, rotates once and revokes", async (t) => {
  const f = await setup(t),
    agents = new AgentStore(f.control),
    remote = new RemoteAgents(agents, f.origin);
  const agent = agents.create(f.owner, {
    name: "CLI editorial agent",
    definition: {
      instructions: "Use synthetic evidence.",
      tools: ["wiki.read", "wiki.file", "wiki.save"],
    },
  });
  f.control.grant(f.owner, agent.id, "editor");
  const profile = await browserLogin(
    f.origin,
    "wiki:read wiki:trace wiki:write",
    async (url) => {
      const params = new URLSearchParams(url.search);
      const invalid = new URL(params.get("redirect_uri"));
      invalid.searchParams.set("state", "forged");
      assert.equal((await fetch(invalid)).status, 400);
      params.set("agent", agent.id);
      params.set("decision", "allow");
      const redirect = remote.approve(f.owner, params);
      assert.equal((await fetch(redirect)).status, 200);
    },
    { timeout: 10000 },
  );
  writeProfile(f.config, profile);
  assert.equal((await f.cli(["whoami"])).result.agent, agent.id);
  assert.equal((await f.cli(["file", fileId])).code, 0);
  const api = new WikiApiClient(profile);
  const saved = await api.request("/api/articles/edits", {
    operation_id: "oauth-cli-retry",
    updates: [update("oauth-note")],
  });
  profile.expires = 0;
  writeProfile(f.config, profile);
  const retry = await f.cli(
    ["save", "--file", "-"],
    JSON.stringify({
      operation_id: "oauth-cli-retry",
      updates: [update("oauth-note")],
    }),
  );
  assert.equal(retry.code, 0, retry.out);
  assert.equal(retry.result.commit, saved.commit);
  assert.notEqual(
    readPrivateJSON(f.config).tokens.refresh_token,
    profile.tokens.refresh_token,
  );
  const fresh = readPrivateJSON(f.config);
  fs.mkdirSync(f.config + ".lock");
  assert.equal((await f.cli(["read", "guide"])).result.code, "CLIENT_BUSY");
  fs.rmdirSync(f.config + ".lock");
  writeProfile(f.config, { ...fresh, refreshPending: true });
  assert.equal((await f.cli(["read", "guide"])).result.code, "LOGIN_REQUIRED");
  writeProfile(f.config, fresh);
  assert.equal((await f.cli(["logout"])).code, 0);
  await assert.rejects(
    new WikiApiClient(fresh).request("/api/articles/guide/current.json"),
    { status: 401 },
  );
});

test("published OpenAPI matches runtime, covers both evidence catalogs and keeps shared edit schema", async (t) => {
  const f = await setup(t);
  const document = openAPI();
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(new URL("../docs/openapi.json", import.meta.url), "utf8"),
    ),
    document,
  );
  assert.deepEqual(
    await (await fetch(f.origin + "/api/openapi.json")).json(),
    document,
  );
  const ids = new Set();
  for (const methods of Object.values(document.paths))
    for (const spec of Object.values(methods)) {
      assert.ok(!ids.has(spec.operationId));
      ids.add(spec.operationId);
      for (const parameter of spec.parameters || [])
        if (parameter.in === "path") assert.equal(parameter.required, true);
    }
  for (const op of operations) {
    assert.equal(document.paths[op.path][op.method].operationId, op.id);
    assert.ok(op.interfaces.cli);
  }
  for (const externalEvidence of [false, true])
    for (const tool of createWikiTools(() => Promise.resolve(), true, {
      externalEvidence,
    }))
      assert.ok(ids.has(tool.name), tool.name);
  const schema =
    document.paths["/api/articles/edits"].post.requestBody.content[
      "application/json"
    ].schema;
  assert.deepEqual(
    schema,
    createWikiTools(() => Promise.resolve(), true).find(
      (tool) => tool.name === "wiki.save",
    ).inputSchema,
  );
});

test("expired CLI sessions can log out and sign in again without printing credentials", async (t) => {
  const f = await setup(t);
  const args = [
    "login",
    "--url",
    f.origin,
    "--email",
    "editor@example.invalid",
    "--password-stdin",
  ];
  assert.equal((await f.cli(args, f.password)).code, 0);
  const session = readPrivateJSON(f.config).session;
  f.control.logout(session);
  assert.equal((await f.cli(["logout"])).code, 0);
  assert.equal((await f.cli(args, f.password)).code, 0);
  fs.writeFileSync(f.config, '{"secret":"SENSITIVE-SENTINEL", bad', {
    mode: 0o600,
  });
  const failure = await f.cli(["read", "guide"]);
  assert.doesNotMatch(failure.out + failure.err, /SENSITIVE-SENTINEL/);
  assert.equal((await f.cli(["logout", "--forget"])).result.revoked, false);
  assert.equal((await f.cli(args, f.password)).code, 0);
});
