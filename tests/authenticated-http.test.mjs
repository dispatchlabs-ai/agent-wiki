import { ControlStore } from "../src/control-store.mjs";
import { importTrace } from "../src/traces.mjs";
import test from "node:test";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { saveGitEdits } from "../src/editor.mjs";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWiki } from "../src/server.mjs";
import { GitWiki, git } from "../src/git-wiki.mjs";
import { registerTools } from "../public/client.js";
import { fixture, update } from "./helpers.mjs";
async function server(t, options = {}) {
  const repo = options.repo || fixture(t),
    origin = "http://wiki.test";
  const control = new ControlStore(path.join(repo, ".git", "control.sqlite3"));
  const actor = control.bootstrap({
    issuer: "https://id.example",
    subject: "owner",
    name: "Owner",
  });
  const session = control.session(actor);
  t.after(() => control.close());
  const app = createWiki({ repo, origin, write: true, control, ...options });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        app.close(resolve);
        app.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (route, options = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        base + route,
        {
          method: options.method || "GET",
          headers: {
            Host: "wiki.test",
            Cookie: `wiki_session=${session.token}`,
            "X-Wiki-CSRF": session.csrf,
            ...options.headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (b) => chunks.push(b));
          res.on("end", () =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers: res.headers,
              }),
            ),
          );
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  const save = (draft) =>
    request("/api/articles/edits", {
      method: "POST",
      headers: {
        Origin: origin,
        "X-Wiki-Write": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draft),
    });
  return { repo, request, save, control, actor, session };
}
test("HTTP reads, same-origin writes, idempotent retries and revision conflicts", async (t) => {
  const { request, save, repo } = await server(t);
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/.git/config")).status, 404);
  assert.equal(
    (await request("/api/articles/health.json", { headers: { Host: "wrong" } }))
      .status,
    403,
  );
  assert.equal(
    (await request("/api/articles/edits", { method: "POST", body: "{}" }))
      .status,
    403,
  );
  assert.equal((await request("/api/articles/search?limit=-1")).status, 400);
  const draft = {
    operation_id: "http-create",
    updates: [update("created", "See [[guide]].")],
  };
  const response = await save(draft);
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.remote, "not-requested");
  assert.equal(receipt.publication, "live");
  const retried = await (await save(draft)).json();
  assert.equal(retried.state, "already-saved");
  assert.equal(retried.commit, receipt.commit);
  assert.equal(
    retried.articles[0].revision_id,
    receipt.articles[0].revision_id,
  );
  const current = await (
    await request("/api/articles/created/current.json")
  ).json();
  assert.equal(current.revision_id, receipt.articles[0].revision_id);
  const stale = await save({ ...draft, operation_id: "stale" });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "REVISION_CONFLICT");
  assert.equal(
    (await request("/api/articles/created/history.json")).status,
    200,
  );
  assert.equal((await request("/api/articles/created/1.json")).status, 200);
  assert.match(
    await (await request("/wiki/created/")).text(),
    /href="\/wiki\/guide\/"/,
  );
  assert.match(
    await (await request("/wiki/guide/")).text(),
    /href="\/wiki\/created\/"/,
  );
  assert.equal(git(repo, ["status", "--porcelain"]), "");
});
test("simultaneous HTTP writers serialize and exactly one stale update succeeds", async (t) => {
  const { request, save, repo } = await server(t);
  const current = await (
    await request("/api/articles/guide/current.json")
  ).json();
  const drafts = ["a", "b"].map((id) => ({
    operation_id: `writer-${id}`,
    updates: [
      {
        ...update("guide", `Writer ${id}.`),
        expected_revision_id: current.revision_id,
      },
    ],
  }));
  const results = await Promise.all(drafts.map(save));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(new GitWiki(repo).history("guide").length, 2);
  assert.equal(git(repo, ["status", "--porcelain"]), "");
});
test("read-only mode and request limits are enforced", async (t) => {
  const { save } = await server(t, { write: false });
  assert.equal((await save({})).status, 403);
  const enabled = await server(t);
  const r = await enabled.request("/api/articles/edits", {
    method: "POST",
    headers: {
      Origin: "http://wiki.test",
      "X-Wiki-Write": "1",
      "Content-Type": "application/json",
    },
    body: "x".repeat(512001),
  });
  assert.equal(r.status, 413);
  const invalid = await enabled.request("/api/articles/edits", {
    method: "POST",
    headers: {
      Origin: "http://wiki.test",
      "X-Wiki-Write": "1",
      "Content-Type": "application/json",
    },
    body: "{",
  });
  assert.equal(invalid.status, 400);
});
test("failed remote push leaves one durable commit and retries push without another revision", async (t) => {
  const repo = fixture(t);
  git(repo, ["remote", "add", "origin", "/nonexistent-agent-wiki-test-remote"]);
  const draft = { operation_id: "retry-push", updates: [update("new")] };
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../src/editor.mjs", import.meta.url))],
        {
          env: {
            ...process.env,
            WIKI_REPO: repo,
            WIKI_PUSH: "1",
            WIKI_GIT_LOCKED: "0",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err += b));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(JSON.parse(out)) : reject(Error(err)),
      );
      child.stdin.end(JSON.stringify(draft));
    });
  const first = await run(),
    second = await run();
  assert.equal(first.remote, "push-failed");
  assert.equal(second.remote, "push-failed");
  assert.equal(second.state, "already-saved");
  assert.equal(first.commit, second.commit);
  assert.equal(new GitWiki(repo).history("new").length, 1);
});
test("WebMCP registers discoverable schemas and invokes the underlying HTTP API", async (t) => {
  const { request } = await server(t),
    original = globalThis.fetch;
  // Adapter contract test; native browser compatibility is verified separately.
  globalThis.fetch = request;
  t.after(() => {
    globalThis.fetch = original;
  });
  const registered = [];
  const controller = await registerTools(
    {
      registerTool: async (tool, options) => registered.push({ tool, options }),
    },
    true,
  );
  assert.deepEqual(
    registered.map((r) => r.tool.name),
    [
      "wiki.search",
      "wiki.read",
      "wiki.history",
      "wiki.traceSearch",
      "wiki.traceProvenance",
      "wiki.traceSessions",
      "wiki.traceLines",
      "wiki.traces",
      "wiki.trace",
      "wiki.save",
      "wiki.preview",
    ],
  );
  const read = registered.find((r) => r.tool.name === "wiki.read").tool;
  assert.equal((await read.execute({ id: "guide" })).title, "Guide");
  assert.equal(
    registered.find((r) => r.tool.name === "wiki.save").tool.annotations
      .readOnlyHint,
    false,
  );
  const traceSearch = registered.find(
    (r) => r.tool.name === "wiki.traceSearch",
  ).tool;
  assert.equal((await traceSearch.execute({ q: "prototype" })).indexed, false);
  assert.equal((await request("/api/traces/search?q=x&limit=99")).status, 400);
  controller.abort();
  assert.ok(registered.every((r) => r.options.signal.aborted));
  const readonly = [];
  await registerTools({ registerTool: (t) => readonly.push(t) }, false);
  assert.equal(readonly.length, 10);
});

test("failed index transactions keep reader and search on one snapshot, then recover", async (t) => {
  const repo = fixture(t),
    database = path.join(repo, ".git", "index.sqlite3");
  const { request } = await server(t, { repo, database });
  const before = git(repo, ["rev-parse", "HEAD"]);
  const db = new DatabaseSync(database);
  t.after(() => db.close());
  db.exec(
    "CREATE TRIGGER fail_index BEFORE INSERT ON pages BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
  );
  saveGitEdits(repo, {
    operation_id: "index-failure",
    updates: [update("new", "Unique recovery phrase.")],
  });
  const health = await request("/api/articles/health.json");
  assert.equal(health.status, 503);
  assert.equal((await health.json()).commit, before);
  assert.equal((await request("/api/articles/new/current.json")).status, 404);
  assert.equal(
    (await (await request("/api/articles/search?q=recovery")).json()).articles
      .length,
    0,
  );
  db.exec("DROP TRIGGER fail_index");
  assert.equal((await request("/api/articles/health.json")).status, 200);
  assert.equal((await request("/api/articles/new/current.json")).status, 200);
  assert.equal(
    (await (await request("/api/articles/search?q=recovery")).json())
      .articles[0].id,
    "new",
  );
});

test("trace HTML and JSON routes share snapshots and validate page requests", async (t) => {
  const repo = fixture(t),
    traces = path.join(repo, ".git", "traces");
  const metadata = importTrace(
    traces,
    new URL("../examples/traces/pi.jsonl", import.meta.url),
    "Synthetic pi",
  );
  const { request } = await server(t, { repo, traces });
  assert.equal(
    (await (await request("/api/traces/catalog.json")).json())[0].id,
    metadata.id,
  );
  const html = await request(metadata.url || `/traces/${metadata.id}/`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Branch change/);
  const data = await (await request(`/api/traces/${metadata.id}.json`)).json();
  assert.equal(data.total_records, 8);
  assert.equal(data.html, undefined);
  assert.equal((await request(`/traces/${metadata.id}/?page=0`)).status, 400);
  assert.equal((await request(`/traces/${metadata.id}/?page=2`)).status, 404);
  assert.equal((await request(`/traces/${"0".repeat(64)}/`)).status, 404);
});

test("unchanged saves and mixed batches return existing revisions on retries", async (t) => {
  const repo = fixture(t);
  const { request } = await server(t, { repo, write: true });
  const save = async (draft) => {
    const response = await request("/api/articles/edits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wiki-Write": "1",
        Origin: "http://wiki.test",
      },
      body: JSON.stringify(draft),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const first = await save({
    operation_id: "initial",
    updates: [update("new")],
  });
  const unchanged = {
    ...update("new"),
    expected_revision_id: first.articles[0].revision_id,
  };
  const draft = {
    operation_id: "mixed",
    updates: [unchanged, update("other")],
  };
  const saved = await save(draft);
  assert.equal(saved.articles[0].number, 1);
  assert.equal(saved.articles[1].number, 1);
  await save({
    operation_id: "later",
    updates: [{ ...unchanged, body: "Later content." }],
  });
  const retry = await save(draft);
  assert.equal(retry.state, "already-saved");
  assert.equal(retry.commit, saved.commit);
  assert.deepEqual(retry.articles, saved.articles);
  assert.equal(new GitWiki(repo).history("new").length, 2);
});

test("writer failures carry stable codes and the browser loads shared limits", async (t) => {
  const { request, save, repo } = await server(t);
  const invalid = await save({
    operation_id: "invalid",
    updates: [update("new", "")],
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_EDIT");
  git(repo, ["checkout", "-b", "other"]);
  const wrongBranch = await save({
    operation_id: "branch",
    updates: [update("new")],
  });
  assert.equal(wrongBranch.status, 409);
  assert.equal((await wrongBranch.json()).code, "BRANCH_CONFLICT");
  assert.match(
    await (await request("/assets/edit-contract.js")).text(),
    /export const editSchema/,
  );
});

test("all content routes deny visitors, enforce current grants and hide commit metadata", async (t) => {
  const { request, control, actor } = await server(t);
  const visitor = control.enroll({
    issuer: "https://id.example",
    subject: "visitor",
    name: "Visitor",
  });
  const login = control.session(visitor.id);
  const routes = [
    "/wiki/",
    "/wiki/guide/",
    "/wiki/guide/history/",
    "/wiki/guide/revision/1/",
    "/wiki/guide/edit/",
    "/search/?q=guide",
    "/api/articles/catalog.json",
    "/api/articles/search?q=guide",
    "/api/articles/guide/current.json",
    "/api/articles/guide/history.json",
    "/api/articles/guide/1.json",
    "/api/articles/health.json",
    "/api/articles/authoring.json",
    "/traces/",
    "/api/traces/catalog.json",
    "/api/traces/search?q=x",
    `/traces/${"a".repeat(64)}/`,
    `/api/traces/${"a".repeat(64)}.json`,
    "/wiki/missing/",
    "/api/access",
  ];
  const headers = { Cookie: `wiki_session=${login.token}` };
  for (const route of routes) {
    const denied = await request(route, { headers });
    assert.equal(denied.status, 404, route);
    assert.equal(denied.headers.get("x-wiki-commit"), null);
    assert.equal((await denied.json()).error, "Not found");
    const anonymous = await request(route, {
      headers: { Cookie: "", "X-Wiki-User": actor },
    });
    assert.equal(anonymous.status, 401, route);
  }
  control.grant(actor, visitor.id, "reader");
  assert.equal((await request("/wiki/guide/", { headers })).status, 200);
  assert.equal((await request("/api/access", { headers })).status, 404);
  control.grant(actor, visitor.id, null);
  assert.equal((await request("/wiki/guide/", { headers })).status, 404);
  assert.equal(
    (await request("/healthz", { headers: { Cookie: "" } })).status,
    200,
  );
  assert.equal(
    (await request("/assets/client.js", { headers: { Cookie: "" } })).status,
    200,
  );
  assert.equal(
    (
      await request("/auth/callback?code=forged&state=forged", {
        headers: { Cookie: "" },
      })
    ).status,
    400,
  );
});

test("revocation during asynchronous trace rendering denies the completed response", async (t) => {
  const { TraceStore } = await import("../src/traces.mjs");
  const original = TraceStore.prototype.read;
  let release, started;
  const pending = new Promise((resolve) => (started = resolve));
  TraceStore.prototype.read = async () => {
    started();
    await new Promise((resolve) => (release = resolve));
    return { html: "SECRET TRACE", records: ["SECRET TRACE"] };
  };
  t.after(() => (TraceStore.prototype.read = original));
  const { request, control, actor } = await server(t);
  const visitor = control.enroll({
    issuer: "https://id.example",
    subject: "reader",
    name: "Reader",
  });
  control.grant(actor, visitor.id, "editor");
  const session = control.session(visitor.id);
  const response = request(`/api/traces/${"a".repeat(64)}.json`, {
    headers: { Cookie: `wiki_session=${session.token}` },
  });
  await pending;
  control.grant(actor, visitor.id, null);
  release();
  assert.equal((await response).status, 404);
  assert.doesNotMatch(await (await response).text(), /SECRET/);
});

test("CSRF, session expiry, manager boundaries and actor-bound retries", async (t) => {
  const { request, control, actor, save } = await server(t);
  const editor = control.enroll({
    issuer: "https://id.example",
    subject: "editor",
    name: "Editor",
  });
  control.grant(actor, editor.id, "editor");
  const session = control.session(editor.id);
  const headers = {
    Cookie: `wiki_session=${session.token}`,
    "X-Wiki-CSRF": session.csrf,
    Origin: "http://wiki.test",
    "Content-Type": "application/json",
    "X-Wiki-Write": "1",
  };
  assert.equal(
    (
      await request("/api/access", {
        method: "POST",
        headers,
        body: JSON.stringify({ principal: editor.id, role: "manager" }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request("/api/articles/edits", {
        method: "POST",
        headers: { ...headers, "X-Wiki-CSRF": "forged" },
        body: "{}",
      })
    ).status,
    403,
  );
  const draft = { operation_id: "shared-id", updates: [update("new")] };
  const first = await (await save(draft)).json();
  assert.equal(first.actor, actor);
  const second = await request("/api/articles/edits", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...draft, actor, updates: [update("different")] }),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).actor, editor.id);
  const expired = control.session(editor.id, -1);
  assert.equal(
    (
      await request("/api/articles/catalog.json", {
        headers: { Cookie: `wiki_session=${expired.token}` },
      })
    ).status,
    401,
  );
  control.db.exec("DROP TABLE grants");
  assert.equal((await request("/api/articles/catalog.json")).status, 404);
});

test("a write queued behind the Git lock loses authorization before publication", async (t) => {
  const { request, control, actor, repo } = await server(t);
  const editor = control.enroll({
    issuer: "https://id.example",
    subject: "queued",
    name: "Queued editor",
  });
  control.grant(actor, editor.id, "editor");
  const session = control.session(editor.id);
  const holder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {withWriterLock} from ${JSON.stringify(new URL("../src/writer-lock.mjs", import.meta.url).href)}; await withWriterLock(${JSON.stringify(repo)}, async()=>{process.stdout.write("locked"); process.stdin.resume(); await new Promise(resolve=>process.stdin.on("end",resolve));});`,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => holder.kill());
  await once(holder.stdout, "data");
  const response = request("/api/articles/edits", {
    method: "POST",
    headers: {
      Cookie: `wiki_session=${session.token}`,
      "X-Wiki-CSRF": session.csrf,
      Origin: "http://wiki.test",
      "Content-Type": "application/json",
      "X-Wiki-Write": "1",
    },
    body: JSON.stringify({
      operation_id: "queued-write",
      updates: [update("queued")],
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  control.grant(actor, editor.id, null);
  holder.stdin.end();
  assert.equal((await response).status, 404);
  assert.equal(new GitWiki(repo).current("queued"), null);
});

test("local setup enforces CSRF, password policy, single use and explicit grants", async (t) => {
  const { request, control, actor } = await server(t, {
    origin: "https://wiki.test",
    localLogin: true,
  });
  const invite = control.inviteLocal(
    actor,
    "local@example.invalid",
    "Local reader",
  );
  const page = await request("/auth/local/setup", { headers: { Cookie: "" } });
  const form = page.headers.get("set-cookie").match(/wiki_form=([^;]+)/)[1];
  const post = (body, headers = {}) =>
    request("/auth/local/setup", {
      method: "POST",
      headers: {
        Cookie: `wiki_form=${form}`,
        Origin: "https://wiki.test",
        "Content-Type": "application/json",
        "X-Wiki-CSRF": form,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await post(
        { token: invite.token, password: "a synthetic long password" },
        { Origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        { token: invite.token, password: "a synthetic long password" },
        { "X-Wiki-CSRF": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await post({ token: invite.token, password: "short" })).status,
    400,
  );
  assert.ok(control.invitation(invite.token));
  const accepted = await post({
    token: invite.token,
    password: "a synthetic long password",
  });
  assert.equal(accepted.status, 200);
  const token = accepted.headers
    .get("set-cookie")
    .match(/wiki_session=([^;]+)/)[1];
  assert.equal(
    (
      await request("/api/articles/catalog.json", {
        headers: { Cookie: `wiki_session=${token}` },
      })
    ).status,
    404,
  );
  assert.equal(
    (await post({ token: invite.token, password: "a synthetic long password" }))
      .status,
    400,
  );
  const accountPage = await request("/account/", {
    headers: { Cookie: `wiki_session=${token}` },
  });
  assert.equal(accountPage.status, 200);
  assert.equal(
    (
      await request("/api/access/invitations", {
        method: "POST",
        headers: { Cookie: `wiki_session=${token}` },
      })
    ).status,
    404,
  );
});

test("MCP retains the caller's session and rejects reader writes and forged CSRF", async (t) => {
  const { request, control, actor, session } = await server(t);
  const reader = control.enroll({
    issuer: "https://id.example",
    subject: "mcp-reader",
    name: "MCP reader",
  });
  control.grant(actor, reader.id, "reader");
  const readSession = control.session(reader.id);
  const call = (name, args, login = session, extra = {}) =>
    request("/mcp", {
      method: "POST",
      headers: {
        Cookie: `wiki_session=${login.token}`,
        "X-Wiki-CSRF": login.csrf,
        Origin: "http://wiki.test",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
        ...extra,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
  const envelope = async (response) => {
    const text = await response.text();
    return JSON.parse(
      text.startsWith("event:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data: "))
            .slice(6)
        : text,
    );
  };
  const read = await call("wiki.read", { id: "guide" }, readSession);
  assert.equal(read.status, 200, await read.clone().text());
  assert.equal(
    JSON.parse((await envelope(read)).result.content[0].text).title,
    "Guide",
  );
  const draft = {
    operation_id: "mcp-auth-write",
    updates: [update("mcp-created")],
  };
  const denied = await call("wiki.save", draft, readSession);
  assert.equal(denied.status, 200);
  const rejection = await envelope(denied);
  assert.ok(rejection.error || rejection.result?.isError);
  const saved = await call("wiki.save", draft);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(
    JSON.parse((await envelope(saved)).result.content[0].text).actor,
    actor,
  );
  assert.equal(
    (
      await call("wiki.read", { id: "guide" }, session, {
        "X-Wiki-CSRF": "forged",
      })
    ).status,
    403,
  );
  control.grant(actor, reader.id, null);
  assert.equal(
    (await call("wiki.read", { id: "guide" }, readSession)).status,
    404,
  );
});

test("article readers cannot retrieve evidence on any response surface", async (t) => {
  const { evidenceFixture, evidenceId, imageId, fileId } =
    await import("./evidence-fixture.mjs");
  const fixture = await evidenceFixture();
  t.after(() => fixture.close());
  const { request, control, actor } = await server(t, {
    evidenceUrl: fixture.url,
  });
  const reader = control.enroll({
    issuer: "https://id.example",
    subject: "evidence-reader",
    name: "Article reader",
  });
  const login = control.session(reader.id);
  const headers = { Cookie: `wiki_session=${login.token}` };
  const routes = [
    `/conversations/${evidenceId}/`,
    `/conversations/${evidenceId}/dialogue.json`,
    `/media/${imageId}`,
    `/media/${fileId}?download=notes.md`,
    `/files/${fileId}/`,
    `/api/files/${fileId}.json`,
    "/api/evidence/v1/catalog",
    "/api/evidence/v1/health",
    "/api/evidence/v1/search?q=prototype",
    "/api/traces/search?q=prototype",
    `/api/traces/${evidenceId}.json`,
    "/api/traces/catalog.json",
    "/traces/",
    `/api/evidence/v1/assets/${imageId}`,
    "/conversations/chat-000000000000000000000000/",
  ];
  for (const role of [null, "reader"]) {
    control.grant(actor, reader.id, role);
    const before = fixture.state.requests.length;
    for (const route of routes) {
      const denied = await request(route, {
        headers: { ...headers, Range: "bytes=0-10" },
      });
      assert.equal(denied.status, 404, `${role}: ${route}`);
      assert.doesNotMatch(
        await denied.text(),
        /Prototype|Captured|fixture-host/,
      );
      assert.equal(
        (await request(route, { headers: { Cookie: "" } })).status,
        401,
        route,
      );
    }
    assert.equal(
      fixture.state.requests.length,
      before,
      "denied reads never contact the archive",
    );
  }
  assert.equal(
    (await request("/api/articles/guide/current.json", { headers })).status,
    200,
  );
  const before = fixture.state.requests.length;
  for (const route of [
    "/search/?q=prototype&sync=1",
    "/search/?q=prototype&type=traces&sync=1",
    "/api/articles/health.json",
  ]) {
    const response = await request(route, { headers });
    assert.equal(response.status, 200, route);
    assert.doesNotMatch(
      await response.text(),
      /Prototype archive|captured prototype|fixture-host|traceArchive/,
    );
  }
  assert.equal(fixture.state.requests.length, before);
  const authoring = await (
    await request("/api/articles/authoring.json", { headers })
  ).json();
  assert.equal(authoring.evidenceAccess, false);
  assert.ok(
    authoring.tools.every(
      (name) => !name.startsWith("wiki.trace") && name !== "wiki.file",
    ),
  );
  control.grant(actor, reader.id, "editor");
  for (const route of routes.slice(0, -1)) {
    const response = await request(route, { headers });
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("cache-control"), "no-store", route);
  }
  fixture.state.delay = 150;
  for (const route of [
    "/api/evidence/v1/search?q=prototype",
    "/search/?q=prototype&sync=1",
    "/api/articles/health.json",
  ]) {
    control.grant(actor, reader.id, "editor");
    const pending = request(route, { headers });
    await new Promise((resolve) => setTimeout(resolve, 30));
    control.grant(actor, reader.id, "reader");
    const denied = await pending;
    assert.equal(denied.status, 404, route);
    assert.doesNotMatch(await denied.text(), /Prototype|captured prototype/);
  }
});

test("late evidence revocation also blocks upstream error bodies", async (t) => {
  const { evidenceFixture, imageId } = await import("./evidence-fixture.mjs");
  const fixture = await evidenceFixture();
  t.after(() => fixture.close());
  fixture.state.failure = true;
  fixture.state.delay = 150;
  const { request, control, actor } = await server(t, {
    evidenceUrl: fixture.url,
  });
  const editor = control.enroll({
    issuer: "https://id.example",
    subject: "late-editor",
    name: "Editor",
  });
  const session = control.session(editor.id);
  for (const route of [
    "/api/evidence/v1/catalog",
    `/media/${imageId}?download=source.png`,
    "/api/articles/health.json",
  ]) {
    control.grant(actor, editor.id, "editor");
    const pending = request(route, {
      headers: { Cookie: `wiki_session=${session.token}` },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    control.grant(actor, editor.id, "reader");
    const response = await pending;
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /restricted source detail/);
  }
});

test("protected browser deep links offer sign in while machine requests retain 401", async (t) => {
  const { request } = await server(t, {
    auth: {
      label: "Continue with identity",
      begin: async () => "",
      finish: async () => ({}),
    },
  });
  for (const route of [
    "/wiki/guide/",
    "/conversations/chat-000000000000000000000000/",
    "/media/" + "a".repeat(64) + ".png",
  ]) {
    const page = await request(route, {
      headers: { Cookie: "", Accept: "text/html" },
    });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /Welcome back/);
    assert.equal(
      (
        await request(route, {
          headers: { Cookie: "", Accept: "application/json" },
        })
      ).status,
      401,
    );
  }
});
