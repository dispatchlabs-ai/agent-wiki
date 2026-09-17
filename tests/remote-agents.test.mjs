import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { ControlStore } from "../src/control-store.mjs";
import { AgentStore } from "../src/agent-store.mjs";
import { RemoteAgents } from "../src/remote-agents.mjs";
import { createWiki } from "../src/server.mjs";
import { fixture, update } from "./helpers.mjs";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

async function setup(t) {
  const repo = fixture(t),
    control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  const portServer = createServer();
  let app;
  t.after(async () => {
    if (app) {
      await new Promise((resolve) => {
        app.close(resolve);
        app.closeAllConnections();
      });
    }
    await new Promise((resolve) => portServer.close(resolve));
    control.close();
  });
  const owner = control.bootstrap({
    issuer: "https://id.example",
    subject: "owner",
    name: "Owner",
  });
  const other = control.enroll({
    issuer: "https://id.example",
    subject: "other",
    name: "Other",
  }).id;
  const stranger = control.enroll({
    issuer: "https://id.example",
    subject: "stranger",
    name: "Stranger",
  }).id;
  const agents = new AgentStore(control);
  const editor = agents.create(owner, {
    name: "Editor",
    definition: {
      instructions: "Use evidence.",
      tools: [
        "wiki.search",
        "wiki.read",
        "wiki.traceSearch",
        "wiki.trace",
        "wiki.save",
      ],
    },
  });
  control.grant(owner, editor.id, "editor");
  agents.permission(owner, editor.id, other, "invoke", true);
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const origin = `http://127.0.0.1:${portServer.address().port}`;
  app = createWiki({
    repo,
    origin,
    control,
    write: true,
    development: true,
  });
  // Adopt the bound listener without releasing its port during setup.
  app.listen(portServer);
  await once(app, "listening");
  const remote = new RemoteAgents(agents, origin);
  const registration = remote.register({
    client_name: "Synthetic client",
    redirect_uris: ["http://127.0.0.1:8765/callback"],
    token_endpoint_auth_method: "none",
  });
  const verifier = "v".repeat(64);
  const params = new URLSearchParams({
    client_id: registration.client_id,
    redirect_uri: registration.redirect_uris[0],
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    resource: origin + "/mcp",
    scope: "wiki:read wiki:trace wiki:write",
    state: "test-state",
  });
  const authorize = (actor = other) => {
    const form = new URLSearchParams(params);
    form.set("agent", editor.id);
    form.set("decision", "allow");
    const redirect = new URL(remote.approve(actor, form));
    return new URLSearchParams({
      client_id: registration.client_id,
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code"),
      code_verifier: verifier,
      redirect_uri: registration.redirect_uris[0],
      resource: origin + "/mcp",
    });
  };
  const token = () => remote.exchange(authorize());
  const bearer = (access) => ({ Authorization: `Bearer ${access}` });
  return {
    repo,
    control,
    owner,
    other,
    stranger,
    agents,
    editor,
    origin,
    remote,
    registration,
    params,
    authorize,
    token,
    bearer,
    app,
  };
}

test("remote user invokes agent without personal space access; MCP read/write attribution and revocation", async (t) => {
  const f = await setup(t);
  const tokens = f.token();
  assert.equal(f.control.role(f.other), null);
  const client = new Client({ name: "synthetic", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(f.origin + "/mcp"), {
      requestInit: { headers: f.bearer(tokens.access_token) },
    }),
  );
  t.after(() => client.close());
  assert.match(client.getInstructions(), /Authenticated agent: Editor/);
  assert.ok(
    (await client.listTools()).tools.some((t) => t.name === "wiki.save"),
  );
  const read = await client.callTool({
    name: "wiki.read",
    arguments: { id: "guide" },
  });
  assert.equal(read.isError, undefined);
  const save = await client.callTool({
    name: "wiki.save",
    arguments: {
      operation_id: "remote-user-save",
      updates: [update("remote-article")],
    },
  });
  assert.equal(save.isError, undefined, JSON.stringify(save));
  const run = await (
    await fetch(f.origin + "/api/agent/run", {
      headers: f.bearer(tokens.access_token),
    })
  ).json();
  assert.equal(run.agent, f.editor.id);
  assert.equal(run.initiator, f.other);
  // A separate control-store instance (the writer boundary) checks the same grant.
  const second = new ControlStore(f.control.filename);
  const secondAgents = new AgentStore(second);
  assert.equal(
    secondAgents.requireToken(
      tokens.access_token,
      f.origin + "/mcp",
      "default",
      "write",
    ).id,
    f.editor.id,
  );
  second.close();
  f.agents.permission(f.owner, f.editor.id, f.other, "invoke", false);
  assert.equal(
    (
      await fetch(f.origin + "/api/articles/guide", {
        headers: f.bearer(tokens.access_token),
      })
    ).status,
    401,
  );
  f.agents.permission(f.owner, f.editor.id, f.other, "invoke", true);
  assert.throws(() =>
    f.agents.authenticate(tokens.access_token, f.origin + "/mcp"),
  );
});

test("PKCE, client/redirect/resource binding, single-use codes, refresh rotation and replay revocation", async (t) => {
  const f = await setup(t);
  const form = f.authorize();
  for (const [k, v] of [
    ["code_verifier", "x".repeat(64)],
    ["redirect_uri", "http://127.0.0.1:8765/elsewhere"],
    ["resource", "https://other.example/mcp"],
  ]) {
    const bad = new URLSearchParams(form);
    bad.set(k, v);
    assert.throws(() => f.remote.exchange(bad));
  }
  const result = f.remote.exchange(form);
  assert.throws(() => f.remote.exchange(form));
  assert.throws(() =>
    f.agents.authenticate(result.access_token, "https://other.example/mcp"),
  );
  const refresh = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: f.registration.client_id,
    refresh_token: result.refresh_token,
    resource: f.origin + "/mcp",
  });
  const next = f.remote.exchange(refresh);
  assert.notEqual(next.refresh_token, result.refresh_token);
  assert.equal(
    f.agents.authenticate(next.access_token, f.origin + "/mcp").id,
    f.editor.id,
  );
  assert.throws(() => f.remote.exchange(refresh));
  assert.throws(() =>
    f.agents.authenticate(next.access_token, f.origin + "/mcp"),
  );
});

test("browser consent requires login, same-origin CSRF and invoke permission; cannot select another agent", async (t) => {
  const f = await setup(t);
  let r = await fetch(f.origin + "/oauth/authorize?" + f.params, {
    headers: { Accept: "text/html" },
  });
  assert.match(await r.text(), /Welcome back/);
  const session = f.control.session(f.other);
  const cookie = "wiki_session=" + session.token;
  r = await fetch(f.origin + "/oauth/authorize?" + f.params, {
    headers: { Cookie: cookie },
  });
  const html = await r.text();
  assert.match(html, /Choose an agent/);
  assert.match(html, /Editor/);
  const form = new URLSearchParams(f.params);
  form.set("agent", f.editor.id);
  form.set("decision", "allow");
  form.set("csrf", "wrong");
  const post = () =>
    fetch(f.origin + "/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: f.origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      redirect: "manual",
    });
  assert.equal((await post()).status, 403);
  form.set("csrf", f.control.authenticate(session.token).csrf);
  r = await post();
  assert.equal(r.status, 200);
  assert.equal(
    new URL((await r.json()).redirect).searchParams.get("state"),
    "test-state",
  );
  assert.throws(() => f.authorize(f.stranger));
  const s = f.control.session(f.stranger);
  r = await fetch(f.origin + "/oauth/authorize?" + f.params, {
    headers: { Cookie: "wiki_session=" + s.token },
  });
  assert.doesNotMatch(await r.text(), /value="[a-f0-9-]+" required/);
  const bad = new URLSearchParams(f.params);
  bad.set("redirect_uri", "https://attacker.example");
  assert.throws(() => f.remote.request(bad));
  assert.throws(() =>
    f.remote.register({ redirect_uris: ["javascript:alert(1)"] }),
  );
  r = await fetch(f.origin + "/agents/", { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /agents-app/);
  assert.equal((await fetch(f.origin + "/assets/vendor/ui.js")).status, 200);
});

test("HTTP OAuth discovery, dynamic registration, token exchange and connection revocation", async (t) => {
  const f = await setup(t);
  const metadata = await (
    await fetch(f.origin + "/.well-known/oauth-authorization-server")
  ).json();
  assert.ok(metadata.grant_types_supported.includes("authorization_code"));
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  const reg = await fetch(f.origin + "/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://localhost:1234/callback"] }),
  });
  assert.equal(reg.status, 201);
  const exchanged = await fetch(f.origin + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: f.authorize(),
  });
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  const actor = f.agents.authenticate(tokens.access_token, f.origin + "/mcp");
  const grant = f.agents.db
    .prepare("SELECT id FROM remote_grants WHERE run=?")
    .get(actor.run);
  assert.throws(() => f.remote.revoke(f.stranger, grant.id));
  f.remote.revoke(f.other, grant.id);
  assert.throws(() =>
    f.agents.authenticate(tokens.access_token, f.origin + "/mcp"),
  );
});

test("expiry, stopped runs, narrowed agent rights and human suspension block remote access", async (t) => {
  const f = await setup(t);
  let tokens = f.token();
  f.agents.db
    .prepare("UPDATE remote_tokens SET expires=0 WHERE kind='access'")
    .run();
  assert.throws(() =>
    f.agents.authenticate(tokens.access_token, f.origin + "/mcp"),
  );
  const refresh = () =>
    f.remote.exchange(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: f.registration.client_id,
        refresh_token: tokens.refresh_token,
      }),
    );
  tokens = refresh();
  assert.equal(
    f.agents.authenticate(tokens.access_token, f.origin + "/mcp").id,
    f.editor.id,
  );
  f.control.grant(f.owner, f.editor.id, "reader");
  assert.throws(() =>
    f.agents.requireToken(
      tokens.access_token,
      f.origin + "/mcp",
      "default",
      "write",
    ),
  );
  assert.throws(refresh);
  f.control.grant(f.owner, f.editor.id, "editor");
  const actor = f.agents.authenticate(tokens.access_token, f.origin + "/mcp");
  f.agents.stop(f.other, actor.run);
  assert.throws(() =>
    f.agents.authenticate(tokens.access_token, f.origin + "/mcp"),
  );
  tokens = f.token();
  f.control.db
    .prepare("UPDATE principals SET active=0 WHERE id=?")
    .run(f.other);
  assert.throws(() =>
    f.agents.authenticate(tokens.access_token, f.origin + "/mcp"),
  );
  assert.throws(refresh);
});

test("invokers cannot configure agents, grant themselves rights or manage another connection", async (t) => {
  const f = await setup(t);
  const session = f.control.session(f.other),
    actor = f.control.authenticate(session.token);
  const request = (body) =>
    fetch(f.origin + "/api/agents", {
      method: "POST",
      headers: {
        Cookie: "wiki_session=" + session.token,
        Origin: f.origin,
        "X-Wiki-CSRF": actor.csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  for (const body of [
    {
      action: "configure",
      agent: f.editor.id,
      definition: { instructions: "changed", tools: [] },
    },
    {
      action: "permission",
      agent: f.editor.id,
      principal: f.other,
      permission: "manage-access",
      enabled: true,
    },
    { action: "role", agent: f.editor.id, role: "manager" },
  ])
    assert.equal((await request(body)).status, 404);
  const tokens = f.token();
  const response = await fetch(f.origin + "/api/agents", {
    headers: f.bearer(tokens.access_token),
  });
  assert.equal(response.status, 404);
  const bad = new URLSearchParams(f.params);
  bad.set("scope", "__proto__");
  assert.throws(() => f.remote.request(bad));
});

test("creating an agent does not reveal the member directory to a non-member", async (t) => {
  const f = await setup(t);
  f.control.inviteLocal(
    f.owner,
    "private-member@example.invalid",
    "Private Member",
  );
  const page = async (principal) => {
    const session = f.control.session(principal);
    const response = await fetch(f.origin + "/agents/", {
      headers: { Cookie: "wiki_session=" + session.token },
    });
    assert.equal(response.status, 200);
    return response.text();
  };
  assert.equal(f.control.role(f.stranger), null);
  f.agents.create(f.stranger, {
    name: "Outsider's agent",
    definition: { instructions: "", tools: [] },
  });
  const outsiderPage = await page(f.stranger);
  assert.doesNotMatch(
    outsiderPage,
    /Private Member|private-member@example\.invalid/,
  );
  const managerPage = await page(f.owner);
  assert.match(managerPage, /Private Member/);
  assert.match(managerPage, /private-member@example\.invalid/);

  // Directory restrictions must not require personal wiki membership to use
  // an agent whose owner has explicitly granted invocation permission.
  assert.equal(f.control.role(f.other), null);
  const tokens = f.token();
  assert.equal(
    f.agents.requireToken(
      tokens.access_token,
      f.origin + "/mcp",
      "default",
      "read",
    ).id,
    f.editor.id,
  );
});
