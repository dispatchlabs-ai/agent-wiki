import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TraceStore } from "../src/traces.mjs";
import { GitWiki, git } from "../src/git-wiki.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { ControlStore } from "../src/control-store.mjs";
import { AgentStore } from "../src/agent-store.mjs";
import { AgentCredential, connectAgent } from "../src/agent-client.mjs";
import { createWiki } from "../src/server.mjs";
import { fixture, update } from "./helpers.mjs";
import { publishArticleMedia } from "../src/article-media.mjs";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicKey = { ...pair.publicKey.export({ format: "jwk" }), alg: "RS256" };

for (const revoke of [false, true]) {
  test(
    `token renewal remains available during edit preparation; revoke=${revoke}`,
    { timeout: 15000 },
    async (t) => {
      const s = await setup(t, { role: "editor" });
      const credential = new AgentCredential(s.config);
      t.after(() => credential.close());
      const token = await credential.token();
      const head = git(s.repo, ["rev-parse", "HEAD"]);
      const shim = path.join(s.repo, ".git", "git-shim");
      fs.mkdirSync(shim);
      const ready = path.join(shim, "ready");
      const release = path.join(shim, "release");
      const realGit = spawnSync("which", ["git"], {
        encoding: "utf8",
      }).stdout.trim();
      fs.writeFileSync(
        path.join(shim, "git"),
        `#!/bin/sh
if [ "$3" = "read-tree" ]; then
  touch "$WIKI_TEST_READY"
  count=0
  while [ ! -f "$WIKI_TEST_RELEASE" ]; do
    count=$((count + 1))
    [ "$count" -lt 1000 ] || exit 70
    sleep 0.01
  done
fi
exec "${realGit}" "$@"
`,
        { mode: 0o700 },
      );
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../src/editor.mjs", import.meta.url))],
        {
          env: {
            ...process.env,
            PATH: `${shim}${path.delimiter}${process.env.PATH}`,
            WIKI_REPO: s.repo,
            WIKI_CONTROL: s.control.filename,
            WIKI_HTTP_WRITE: "1",
            WIKI_GIT_LOCKED: "0",
            WIKI_PUSH: "0",
            WIKI_AGENT_TOKEN: token,
            WIKI_AGENT_AUDIENCE: s.origin + "/mcp",
            WIKI_EVIDENCE_URL: "",
            WIKI_SESSION: "",
            WIKI_TEST_READY: ready,
            WIKI_TEST_RELEASE: release,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (data) => (out += data));
      child.stderr.on("data", (data) => (err += data));
      const closed = once(child, "close");
      try {
        child.stdin.end(
          JSON.stringify({
            operation_id: "renew-during-write",
            updates: [update("created")],
          }),
        );
        const deadline = Date.now() + 10000;
        while (
          !fs.existsSync(ready) &&
          child.exitCode === null &&
          Date.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(
          fs.existsSync(ready),
          err || "writer did not reach preparation gate",
        );
        // A held writer transaction must fail quickly rather than stall the suite.
        s.control.db.exec("PRAGMA busy_timeout=150");
        credential.expires = 0;
        assert.notEqual(await credential.token(), token);
        if (revoke) s.agents.revokeKey(s.spec.agent, s.spec.key);
        fs.writeFileSync(release, "");
        const [code] = await closed;
        if (revoke) {
          assert.equal(code, 1, out);
          assert.equal(JSON.parse(err.trim().split("\n").at(-1)).status, 404);
          assert.equal(git(s.repo, ["rev-parse", "HEAD"]), head);
        } else {
          assert.equal(code, 0, err);
          assert.equal(JSON.parse(out).state, "saved");
          assert.ok(new GitWiki(s.repo).current("created"));
        }
        assert.equal(git(s.repo, ["status", "--porcelain"]), "");
      } finally {
        fs.writeFileSync(release, "");
        await closed;
      }
    },
  );
}
function registration(name = "Researcher") {
  return {
    version: 1,
    agent: randomUUID(),
    key: randomUUID(),
    name,
    publicKey,
    expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    definition: {
      instructions: "Find source evidence",
      tools: ["wiki.search", "wiki.read", "wiki.traceSearch", "wiki.trace"],
    },
  };
}
async function setup(
  t,
  { role = "reader", mode = "independent", options = {} } = {},
) {
  const repo = fixture(t);
  const control = new ControlStore(path.join(repo, ".git", "control.sqlite3"));
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
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const origin = `http://127.0.0.1:${portServer.address().port}`;
  const owner = control.bootstrap({
    issuer: "https://id.example",
    subject: "owner",
    name: "Owner",
  });
  const agents = new AgentStore(control);
  const spec = registration();
  agents.enrollOperator(spec, owner, role, mode);
  const keyFile = path.join(repo, ".git", "agent.pem");
  fs.writeFileSync(keyFile, pem, { mode: 0o600 });
  const config = {
    version: 1,
    endpoint: origin + "/mcp",
    agent: spec.agent,
    key: spec.key,
    privateKeyFile: keyFile,
    scope: role === "reader" ? "wiki:read" : "wiki:read wiki:trace wiki:write",
  };
  app = createWiki({
    repo,
    origin,
    control,
    write: true,
    development: true,
    ...options,
  });
  // Adopt the bound listener without releasing its port during setup.
  app.listen(portServer);
  await once(app, "listening");
  const request = (route, token, init = {}) =>
    fetch(origin + route, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  const assertion = async (claims = {}, signingKey = pem) =>
    new SignJWT({ wiki_key: spec.key, ...claims })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(claims.iss || spec.agent)
      .setSubject(claims.sub || spec.agent)
      .setAudience(claims.aud || origin)
      .setIssuedAt(claims.iat ?? Math.floor(Date.now() / 1000))
      .setExpirationTime(claims.exp ?? Math.floor(Date.now() / 1000) + 60)
      .setJti(claims.jti || randomUUID())
      .sign(await importPKCS8(signingKey, "RS256"));
  const exchange = async (signed, extra = {}) =>
    request("/oauth/token", null, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: spec.agent,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: signed,
        resource: origin + "/mcp",
        ...extra,
      }),
    });
  return {
    repo,
    origin,
    control,
    owner,
    agents,
    spec,
    config,
    request,
    assertion,
    exchange,
  };
}

test("registered agent connects through SDK OAuth, discovers and reads via MCP", async (t) => {
  const s = await setup(t);
  const connection = await connectAgent(s.config);
  t.after(() => connection.close());
  const { tools } = await connection.client.listTools();
  assert(tools.some((tool) => tool.name === "wiki.search"));
  assert(!tools.some((tool) => tool.name === "wiki.save"));
  const result = await connection.client.callTool({
    name: "wiki.search",
    arguments: { q: "guide" },
  });
  assert(!result.isError, JSON.stringify(result));
  assert(
    result.content.some(
      (part) => part.type === "text" && part.text.includes("guide"),
    ),
  );
  const run = s.agents.run(connection.credential.run);
  assert.equal(run.agent, s.spec.agent);
  assert.equal(run.initiator, s.owner);
  assert.equal(run.mode, "independent");
  assert.equal(run.subject, null);
});

test("read-scoped agents can fetch published article media but cannot rewrite evidence URLs", async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agent-media-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "image.png");
  fs.writeFileSync(
    source,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const published = await publishArticleMedia({
    root: path.join(temporary, "published"),
    sourceFile: source,
    source: "synthetic:approved-image",
  });
  const s = await setup(t, {
    options: { articleMediaRoot: path.join(temporary, "published") },
  });
  const credential = new AgentCredential(s.config);
  t.after(() => credential.close());
  const token = await credential.token();
  assert.equal((await s.request(published.url, token)).status, 200);
  assert.equal(
    (await s.request(`/media/${published.asset}`, token)).status,
    404,
  );
  s.agents.revokeKey(s.spec.agent, s.spec.key);
  assert.equal((await s.request(published.url, token)).status, 401);
});

test("token renewal keeps the same run and concurrent renewal happens once", async (t) => {
  const s = await setup(t);
  let advance = 0;
  const credential = new AgentCredential(s.config, {
    now: () => Date.now() + advance,
  });
  t.after(() => credential.close());
  const first = await credential.token(),
    run = credential.run;
  advance = 290000;
  const renewed = await Promise.all(
    Array.from({ length: 5 }, () => credential.token()),
  );
  assert(renewed.every((token) => token === renewed[0]));
  assert.notEqual(renewed[0], first);
  assert.equal(credential.run, run);
  assert.equal(
    Number(s.control.db.prepare("SELECT count(*) n FROM agent_tokens").get().n),
    2,
  );
  s.agents.revokeKey(s.spec.agent, s.spec.key);
  assert.equal(
    (await s.request("/api/articles/catalog.json", renewed[0])).status,
    401,
  );
  advance += 290000;
  await assert.rejects(credential.token(), /authentication failed/);
  assert.equal(
    Number(s.control.db.prepare("SELECT count(*) n FROM agent_runs").get().n),
    1,
  );
});

test("assertions reject replay, wrong audience, forged identity, future/long expiry and foreign run", async (t) => {
  const s = await setup(t);
  const signed = await s.assertion();
  const response = await s.exchange(signed);
  assert.equal(response.status, 200);
  const token = await response.json();
  assert.equal((await s.exchange(signed)).status, 401);
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { aud: "https://other.example" },
    { sub: randomUUID() },
    { iat: now + 10 },
    { exp: now + 600 },
    { exp: now - 1 },
    { wiki_run: randomUUID() },
    { wiki_key: randomUUID() },
  ])
    assert.equal(
      (await s.exchange(await s.assertion(claims))).status,
      401,
      JSON.stringify(claims),
    );
  assert.equal(
    (
      await s.exchange(await s.assertion(), {
        resource: "https://other.example/mcp",
      })
    ).status,
    400,
  );
  const attacker = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs8", format: "pem" });
  assert.equal((await s.exchange(await s.assertion({}, attacker))).status, 401);
  const second = registration("Another agent");
  s.agents.enrollOperator(second, s.owner);
  const anotherCredential = new AgentCredential({
    ...s.config,
    agent: second.agent,
    key: second.key,
  });
  await anotherCredential.token();
  assert.equal(
    (await s.exchange(await s.assertion({ wiki_run: anotherCredential.run })))
      .status,
    401,
  );
  anotherCredential.close();
  assert.equal(
    (await s.request("/api/articles/catalog.json", token.access_token)).status,
    200,
  );
});

test("agent authority never falls back to a cookie or account administration", async (t) => {
  const s = await setup(t);
  const credential = new AgentCredential({ ...s.config, scope: "wiki:read" });
  const token = await credential.token();
  t.after(() => credential.close());
  const session = s.control.session(s.owner);
  assert.equal(
    (
      await s.request("/api/articles/catalog.json", "invalid", {
        headers: { Cookie: `wiki_session=${session.token}` },
      })
    ).status,
    401,
  );
  for (const route of [
    "/api/me",
    "/api/access",
    "/account/",
    "/auth/logout",
    "/api/traces/search",
    "/api/evidence/v1/health",
  ])
    assert.equal((await s.request(route, token)).status, 404, route);
  assert.equal(
    (
      await s.request("/api/articles/catalog.json", token, {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await s.request("/api/articles/catalog.json", token)).status,
    200,
  );
  s.control.grant(s.owner, s.spec.agent, null);
  assert.equal(
    (await s.request("/api/articles/catalog.json", token)).status,
    404,
  );
  assert.equal(s.agents.hasSpace(s.owner, "unknown", "read"), false);
});

test("delegated runs retain their subject and lose current user authority", async (t) => {
  const s = await setup(t, { mode: "delegated" });
  assert.equal(s.control.role(s.spec.agent), null);
  const credential = new AgentCredential(s.config);
  const token = await credential.token();
  t.after(() => credential.close());
  assert.equal(s.agents.run(credential.run).subject, s.owner);
  const other = s.control.enroll({
    issuer: "https://id.example",
    subject: "other",
    name: "Other",
  });
  s.control.grant(s.owner, other.id, "manager");
  s.control.grant(other.id, s.owner, null);
  assert.equal(
    (await s.request("/api/articles/catalog.json", token)).status,
    404,
  );
  // Even adding standing rights cannot rescue a delegated denial.
  s.control.grant(other.id, s.spec.agent, "editor");
  assert.equal(
    (await s.request("/api/articles/catalog.json", token)).status,
    404,
  );
});

test("agent edits commit trusted run attribution and preserve retry identity across tokens", async (t) => {
  const s = await setup(t, { role: "editor" });
  const credential = new AgentCredential(s.config);
  const first = await credential.token();
  t.after(() => credential.close());
  const draft = {
    operation_id: "agent-edit",
    updates: [update("agent-created", "See [[guide]].")],
  };
  const save = (token) =>
    s.request("/api/articles/edits", token, {
      method: "POST",
      headers: { "X-Wiki-Write": "1", "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
  const response = await save(first);
  const receipt = await response.json();
  assert.equal(response.status, 200, JSON.stringify(receipt));
  assert.equal(receipt.actor, s.spec.agent);
  assert.equal(receipt.authority.run, credential.run);
  assert.equal(receipt.authority.subject, null);
  credential.expires = 0;
  const renewed = await credential.token();
  const retry = await (await save(renewed)).json();
  assert.equal(retry.state, "already-saved");
  assert.equal(retry.commit, receipt.commit);
  s.agents.stop(s.owner, credential.run);
  assert.equal((await save(renewed)).status, 401);
});

test("public enrollment is repeatable, rejects private keys and records no implicit owner rights", async (t) => {
  const s = await setup(t);
  assert.equal(s.agents.enrollOperator(s.spec, s.owner).changed, false);
  assert.throws(
    () => s.agents.enrollOperator({ ...s.spec, name: "Changed" }, s.owner),
    /Registration changed/,
  );
  const invalid = registration();
  invalid.publicKey = pair.privateKey.export({ format: "jwk" });
  invalid.publicKey.alg = "RS256";
  assert.throws(() => s.agents.enrollOperator(invalid, s.owner), /public JWK/);
  assert.equal(
    s.control.db
      .prepare("SELECT 1 FROM principals WHERE id=?")
      .get(invalid.agent),
    undefined,
  );
  const a = s.agents.create(s.owner, {
    name: "No grants",
    definition: { instructions: "", tools: [] },
  });
  assert.equal(s.control.role(a.id), null);
});

test("CLI registration and stdio adapter give two processes distinct runs and close them", async (t) => {
  const s = await setup(t);
  const engine = fileURLToPath(new URL("..", import.meta.url));
  const configFile = path.join(s.repo, ".git", "second.json");
  const generated = spawnSync(
    process.execPath,
    [
      "scripts/agent-keygen.mjs",
      configFile,
      "--origin",
      s.origin,
      "--name",
      "Second reader",
    ],
    { cwd: engine, encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const files = JSON.parse(generated.stdout);
  const enrolled = spawnSync(
    process.execPath,
    [
      "scripts/agent-admin.mjs",
      "register",
      files.publicRegistration,
      "--owner",
      s.owner,
    ],
    {
      cwd: engine,
      env: { ...process.env, WIKI_CONTROL: s.control.filename },
      encoding: "utf8",
    },
  );
  assert.equal(enrolled.status, 0, enrolled.stderr);
  assert.equal(JSON.parse(enrolled.stdout).agent, files.agent);
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const client = new Client({ name: "stdio-consumer", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(engine, "scripts/agent-mcp.mjs"), configFile],
      stderr: "pipe",
    });
    let diagnostics = "";
    transport.stderr.on("data", (chunk) => (diagnostics += chunk));
    await client.connect(transport);
    clients.push(client);
    t.after(() => client.close());
    assert.match(client.getInstructions(), /Second reader/);
    const result = await client.callTool({
      name: "wiki.search",
      arguments: { q: "guide" },
    });
    assert(!result.isError, JSON.stringify(result));
    assert.doesNotMatch(diagnostics, /BEGIN PRIVATE KEY|access_token/);
  }
  const runs = s.control.db
    .prepare("SELECT * FROM agent_runs WHERE agent=? AND active=1")
    .all(files.agent);
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0].id, runs[1].id);
  await Promise.all(clients.map((client) => client.close()));
  for (
    let attempts = 0;
    attempts < 100 &&
    s.control.db
      .prepare("SELECT count(*) n FROM agent_runs WHERE agent=? AND active=1")
      .get(files.agent).n;
    attempts++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    Number(
      s.control.db
        .prepare("SELECT count(*) n FROM agent_runs WHERE agent=? AND active=1")
        .get(files.agent).n,
    ),
    0,
  );
});

test("revocation while rendering a trace prevents release of its contents", async (t) => {
  const original = TraceStore.prototype.read;
  let release, started;
  const pending = new Promise((resolve) => (started = resolve));
  TraceStore.prototype.read = async () => {
    started();
    await new Promise((resolve) => (release = resolve));
    return { html: "HIDDEN EVIDENCE", records: ["HIDDEN EVIDENCE"] };
  };
  t.after(() => (TraceStore.prototype.read = original));
  const s = await setup(t, { role: "editor" });
  const credential = new AgentCredential(s.config);
  const token = await credential.token();
  t.after(() => credential.close());
  const request = s.request(`/api/traces/${"a".repeat(64)}.json`, token);
  await pending;
  s.agents.revokeKey(s.spec.agent, s.spec.key);
  release();
  const response = await request;
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /HIDDEN/);
});

test("queued agent write rechecks revocation at publication", async (t) => {
  const s = await setup(t, { role: "editor" });
  const credential = new AgentCredential(s.config);
  const token = await credential.token();
  t.after(() => credential.close());
  const holder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {withWriterLock} from ${JSON.stringify(new URL("../src/writer-lock.mjs", import.meta.url).href)}; await withWriterLock(${JSON.stringify(s.repo)}, async()=>{process.stdout.write("locked"); process.stdin.resume(); await new Promise(resolve=>process.stdin.on("end",resolve));});`,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => holder.kill());
  await once(holder.stdout, "data");
  const response = s.request("/api/articles/edits", token, {
    method: "POST",
    headers: { "X-Wiki-Write": "1", "Content-Type": "application/json" },
    body: JSON.stringify({
      operation_id: "queued-agent",
      updates: [update("queued-agent")],
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  s.agents.revokeKey(s.spec.agent, s.spec.key);
  holder.stdin.end();
  assert.equal((await response).status, 404);
  assert.equal(new GitWiki(s.repo).current("queued-agent"), null);
});

test("metadata cannot redirect credentials and private files require restrictive permissions", async (t) => {
  const s = await setup(t);
  const destinations = [];
  const credential = new AgentCredential(s.config, {
    fetch: async (input) => {
      destinations.push(String(input));
      return Response.json({
        resource: s.config.endpoint,
        authorization_servers: ["https://untrusted.example"],
        scopes_supported: ["wiki:read"],
      });
    },
  });
  await assert.rejects(credential.token(), /authentication failed/);
  assert(destinations.every((url) => url.startsWith(s.origin + "/")));
  await credential.close();
  fs.chmodSync(s.config.privateKeyFile, 0o644);
  assert.throws(() => new AgentCredential(s.config), /mode 0600/);
});

test("expired server tokens renew once without switching run or authority", async (t) => {
  const s = await setup(t);
  const connection = await connectAgent(s.config);
  const run = connection.credential.run;
  s.control.db.prepare("UPDATE agent_tokens SET expires=0").run();
  const result = await connection.client.callTool({
    name: "wiki.search",
    arguments: { q: "guide" },
  });
  assert(!result.isError, JSON.stringify(result));
  assert.equal(connection.credential.run, run);
  assert.equal(
    Number(s.control.db.prepare("SELECT count(*) n FROM agent_runs").get().n),
    1,
  );
  await connection.close();
  assert.throws(() => s.agents.run(run), /Not found/);
});

test("persistent independent enrollments survive years and remain individually revocable", async (t) => {
  const s = await setup(t);
  const spec = { ...s.spec, key: randomUUID(), expiresAt: null };
  assert.equal(s.agents.enrollOperator(spec, s.owner).changed, true);
  assert.equal(s.agents.enrollOperator(spec, s.owner).changed, false);
  const now = Date.now() + 2 * 365 * 86400000;
  s.agents.now = () => now;
  assert.doesNotThrow(() => s.agents.key(spec.agent, spec.key));
  assert.throws(() => s.agents.key(s.spec.agent, s.spec.key));
  const first = s.agents.issue(
    spec.agent,
    spec.key,
    null,
    s.origin + "/mcp",
    null,
    randomUUID(),
    now + 60000,
    300,
  );
  const run = s.agents.run(first.wiki_run);
  assert.equal(run.expires, now + 300000);
  assert.equal(first.expires_in, 300);
  assert.equal(
    s.agents.authenticate(first.access_token, s.origin + "/mcp").id,
    spec.agent,
  );
  s.agents.revokeKey(spec.agent, spec.key);
  assert.throws(() =>
    s.agents.authenticate(first.access_token, s.origin + "/mcp"),
  );
  assert.throws(() => s.agents.enrollOperator(spec, s.owner));
});

test("persistent enrollment is explicit and never creates unbounded delegation or runs", async (t) => {
  const s = await setup(t);
  for (const expiresAt of [undefined, "", "invalid"]) {
    assert.throws(() =>
      s.agents.enrollOperator({ ...registration(), expiresAt }, s.owner),
    );
  }
  assert.throws(() =>
    s.agents.enrollOperator(
      { ...registration(), expiresAt: null },
      s.owner,
      "reader",
      "delegated",
    ),
  );
  for (const wiki_run_duration of [0, 59, 86401, null, "300", 300.5]) {
    assert.equal(
      (await s.exchange(await s.assertion({ wiki_run_duration }))).status,
      401,
    );
  }
  const response = await s.exchange(
    await s.assertion({ wiki_run_duration: 300 }),
  );
  assert.equal(response.status, 200);
  const token = await response.json();
  assert(s.agents.run(token.wiki_run).expires <= Date.now() + 300000);
});

test("header helpers use independent short runs and return no private key or refresh token", async (t) => {
  const s = await setup(t, { role: "editor" });
  const configFile = path.join(s.repo, ".git", "headers.json");
  fs.writeFileSync(configFile, JSON.stringify(s.config), { mode: 0o600 });
  const helper = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        "scripts/agent-headers.mjs",
        configFile,
      ]);
      let out = "",
        err = "";
      child.stdout.on("data", (data) => {
        out += data;
      });
      child.stderr.on("data", (data) => {
        err += data;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code) reject(Error(err));
        else resolve(JSON.parse(out));
      });
    });
  const results = await Promise.all(Array.from({ length: 6 }, helper));
  assert.equal(new Set(results.map((x) => x.Authorization)).size, 6);
  for (const headers of results) {
    assert.deepEqual(Object.keys(headers), ["Authorization"]);
    assert.match(headers.Authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
    const actor = s.agents.authenticate(
      headers.Authorization.slice(7),
      s.origin + "/mcp",
    );
    assert(s.agents.run(actor.run).expires <= Date.now() + 300000);
    assert.equal(
      (
        await s.request(
          "/api/articles/catalog.json",
          headers.Authorization.slice(7),
        )
      ).status,
      200,
    );
  }
  s.agents.revokeKey(s.spec.agent, s.spec.key);
  await assert.rejects(helper(), /Wiki machine authentication failed/);
  for (const headers of results)
    assert.equal(
      (
        await s.request(
          "/api/articles/catalog.json",
          headers.Authorization.slice(7),
        )
      ).status,
      401,
    );
});

test("persistent machine edit retries retain receipts across independent token runs", async (t) => {
  const s = await setup(t, { role: "editor" });
  const persistent = { ...s.spec, key: randomUUID(), expiresAt: null };
  s.agents.enrollOperator(persistent, s.owner, "editor");
  const a = new AgentCredential(
    { ...s.config, key: persistent.key },
    { runLifetimeSeconds: 300 },
  );
  const b = new AgentCredential(
    { ...s.config, key: persistent.key },
    { runLifetimeSeconds: 300 },
  );
  t.after(async () => {
    await a.close();
    await b.close();
  });
  const draft = {
    operation_id: "persistent-retry",
    updates: [update("machine-created", "See [[guide]].")],
  };
  const save = (token) =>
    s.request("/api/articles/edits", token, {
      method: "POST",
      headers: { "X-Wiki-Write": "1", "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
  const first = await save(await a.token());
  assert.equal(first.status, 200);
  const receipt = await first.json();
  const second = await save(await b.token());
  assert.equal(second.status, 200);
  const retry = await second.json();
  assert.notEqual(a.run, b.run);
  assert.equal(retry.state, "already-saved");
  assert.equal(retry.commit, receipt.commit);
  assert.equal(retry.authority.run, a.run);
  assert.equal(retry.authority.credential, persistent.key);
  s.agents.revokeKey(persistent.agent, persistent.key);
  assert.equal((await save(b.accessToken)).status, 401);
});

test("editor agents need explicit trace scope for evidence tools, files, health and downloads", async (t) => {
  const { evidenceFixture, evidenceId, fileId } =
    await import("./evidence-fixture.mjs");
  const evidence = await evidenceFixture();
  t.after(() => evidence.close());
  const s = await setup(t, {
    role: "editor",
    options: { evidenceUrl: evidence.url },
  });
  s.agents.configure(s.owner, s.spec.agent, {
    instructions: "Use synthetic evidence",
    tools: ["wiki.read", "wiki.trace", "wiki.file", "wiki.save"],
  });
  const full = await connectAgent(s.config);
  t.after(() => full.close());
  assert.ok(
    (await full.client.listTools()).tools.some(
      (tool) => tool.name === "wiki.file",
    ),
  );
  const file = await full.client.callTool({
    name: "wiki.file",
    arguments: { asset: fileId },
  });
  assert.equal(file.isError, undefined, JSON.stringify(file));
  const token = await full.credential.token();
  assert.equal(
    (await s.request(`/media/${fileId}?download=note.md`, token)).status,
    200,
  );
  assert.equal(
    (await s.request(`/conversations/${evidenceId}/`, token)).status,
    200,
  );
  const narrow = await connectAgent({
    ...s.config,
    scope: "wiki:read wiki:write",
  });
  t.after(() => narrow.close());
  assert.ok(
    !(await narrow.client.listTools()).tools.some(
      (tool) => tool.name === "wiki.file",
    ),
  );
  const narrowToken = await narrow.credential.token();
  const before = evidence.state.requests.length;
  for (const route of [
    `/api/files/${fileId}.json`,
    `/media/${fileId}`,
    `/api/traces/${evidenceId}.json`,
  ])
    assert.equal((await s.request(route, narrowToken)).status, 404);
  const health = await (
    await s.request("/api/articles/health.json", narrowToken)
  ).json();
  assert.equal(health.components.traceArchive, undefined);
  assert.equal(evidence.state.requests.length, before);
  s.control.grant(s.owner, s.spec.agent, "reader");
  assert.equal(
    (await s.request(`/api/files/${fileId}.json`, token)).status,
    404,
  );
  assert.equal(
    (await s.request("/api/articles/guide/current.json", token)).status,
    200,
  );
});

test("operator scopes keep a trace researcher from acquiring publication tokens", async (t) => {
  const s = await setup(t, { role: "editor" });
  const spec = {
    ...s.spec,
    key: randomUUID(),
    scope: [{ space: "default", actions: ["read", "trace"] }],
  };
  s.agents.enrollOperator(spec, s.owner, "editor");
  assert.equal(s.agents.enrollOperator(spec, s.owner, "editor").changed, false);
  const narrow = new AgentCredential({
    ...s.config,
    key: spec.key,
    scope: "wiki:read wiki:trace",
  });
  const escalation = new AgentCredential({ ...s.config, key: spec.key });
  t.after(async () => {
    await narrow.close();
    await escalation.close();
  });
  const token = await narrow.token();
  assert.equal(
    (await s.request("/api/articles/catalog.json", token)).status,
    200,
  );
  const save = await s.request("/api/articles/edits", token, {
    method: "POST",
    headers: { "X-Wiki-Write": "1", "Content-Type": "application/json" },
    body: JSON.stringify({
      operation_id: "forbidden-research-write",
      updates: [update("forbidden-research", "Research draft")],
    }),
  });
  assert.equal(save.status, 404);
  await assert.rejects(escalation.token());
  assert.throws(
    () =>
      s.agents.enrollOperator(
        {
          ...registration(),
          scope: [{ space: "default", actions: ["read", "trace"] }],
        },
        s.owner,
        "reader",
      ),
    /scope exceeds/,
  );
  assert.throws(
    () =>
      s.agents.enrollOperator(
        { ...registration(), scope: [{ space: "other", actions: ["read"] }] },
        s.owner,
        "editor",
      ),
    /scope exceeds/,
  );
});

test("machine MCP transport honors caller cancellation and keeps authentication bounded", async (t) => {
  const s = await setup(t);
  const signals = [];
  const credential = new AgentCredential(s.config, {
    fetch: async (_url, init) => {
      signals.push(init.signal);
      return new Response("{}");
    },
  });
  t.after(() => credential.close());
  await credential.fetch(s.origin + "/mcp");
  assert.equal(signals.pop(), undefined);
  const abort = new AbortController();
  await credential.fetch(s.origin + "/mcp", { signal: abort.signal });
  assert.equal(signals.pop(), abort.signal);
  await credential.fetch(s.origin + "/.well-known/oauth-authorization-server");
  assert.ok(signals.pop() instanceof AbortSignal);
});
