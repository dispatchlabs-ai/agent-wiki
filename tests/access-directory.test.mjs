import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { ControlStore } from "../src/control-store.mjs";
import { AgentStore } from "../src/agent-store.mjs";
import { accessDirectory } from "../src/access-ui.mjs";
import { createWiki } from "../src/server.mjs";
import { fixture } from "./helpers.mjs";

function setup(t) {
  const repo = fixture(t);
  const control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  t.after(() => control.close());
  const manager = control.bootstrap({
    issuer: "https://id.example",
    subject: "manager",
    name: "Wiki manager",
  });
  const author = control.enroll({
    issuer: "https://id.example",
    subject: "author",
    name: "Article author",
  }).id;
  const successor = control.enroll({
    issuer: "https://id.example",
    subject: "successor",
    name: "New owner",
  }).id;
  control.grant(manager, author, "reader");
  const agents = new AgentStore(control);
  const agent = agents.create(author, {
    name: "Research assistant",
    definition: {
      instructions:
        "Private instructions are not part of the access directory.",
      tools: ["wiki.search", "wiki.read"],
    },
  });
  return { repo, control, manager, author, successor, agents, agent };
}

test("manager directory shows agents owned by others without granting control", (t) => {
  const f = setup(t);
  assert.deepEqual(f.agents.list(f.manager), []);
  const entry = accessDirectory(f.agents, f.manager).agents[0];
  assert.equal(entry.name, "Research assistant");
  assert.equal(entry.creator.id, f.author);
  assert.equal(entry.creator.identities[0].subject, "author");
  assert.equal(entry.owner.id, f.author);
  assert.equal(entry.role, null);
  assert.equal(entry.manage, false);
  assert.deepEqual(entry.tools, ["wiki.search", "wiki.read"]);
  assert.equal(JSON.stringify(entry).includes("Private instructions"), false);
  assert.throws(() => accessDirectory(f.agents, f.author));
  assert.throws(() => accessDirectory(f.agents, f.successor));
  assert.throws(() => accessDirectory(f.agents, f.agent.id));
  assert.throws(() =>
    f.agents.permission(f.manager, f.agent.id, f.manager, "invoke", true),
  );
  assert.throws(() =>
    f.agents.configure(f.manager, f.agent.id, { instructions: "", tools: [] }),
  );
  assert.equal(f.agents.allowed(f.manager, f.agent.id, "invoke"), false);
  f.control.grant(f.manager, f.agent.id, "editor");
  assert.equal(accessDirectory(f.agents, f.manager).agents[0].role, "editor");
  assert.equal(f.agents.allowed(f.manager, f.agent.id, "invoke"), false);
});

test("creator remains distinct from a transferred owner and survives disabled identities", (t) => {
  const f = setup(t);
  f.agents.permission(f.author, f.agent.id, f.manager, "configure", true);
  f.agents.transfer(f.author, f.agent.id, f.successor);
  f.control.db
    .prepare("UPDATE principals SET active=0 WHERE id=?")
    .run(f.author);
  const entry = accessDirectory(f.agents, f.manager).agents[0];
  assert.equal(entry.creator.id, f.author);
  assert.equal(entry.creator.active, false);
  assert.equal(entry.owner.id, f.successor);
  assert.equal(entry.owner.active, true);
  assert.equal(entry.grants[0].person.id, f.manager);
  assert.equal(entry.grants[0].permission, "configure");
  assert.equal(entry.manage, false);
});

test("missing and operator creation records never falsely attribute creation to the owner", (t) => {
  const f = setup(t);
  f.control.db
    .prepare(
      "UPDATE audit SET actor='operator' WHERE action='agent:create' AND target=?",
    )
    .run(f.agent.id);
  assert.equal(
    accessDirectory(f.agents, f.manager).agents[0].creator.name,
    "Operator",
  );
  f.control.db
    .prepare("DELETE FROM audit WHERE action='agent:create' AND target=?")
    .run(f.agent.id);
  const entry = accessDirectory(f.agents, f.manager).agents[0];
  assert.equal(entry.creator, null);
  assert.equal(entry.owner.id, f.author);
  f.control.db
    .prepare(
      "INSERT INTO principals(id,kind,name) VALUES ('legacy','agent','Legacy credential')",
    )
    .run();
  const legacy = accessDirectory(f.agents, f.manager).agents.find(
    (a) => a.id === "legacy",
  );
  assert.equal(legacy.creator, null);
  assert.equal(legacy.owner, null);
  assert.equal(legacy.tools, null);
  assert.equal(legacy.manage, false);
});

test("HTTP directory and HTML deny non-managers, retain CSRF and reflect revoked access", async (t) => {
  const f = setup(t);
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const origin = `http://127.0.0.1:${listener.address().port}`;
  const app = createWiki({
    repo: f.repo,
    origin,
    control: f.control,
    write: true,
    development: true,
  });
  app.listen(listener);
  await once(app, "listening");
  t.after(async () => {
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
    await new Promise((resolve) => listener.close(resolve));
  });
  const session = f.control.session(f.manager);
  const headers = { Cookie: "wiki_session=" + session.token };
  for (const route of ["/api/access", "/access/"]) {
    const managerResult = await fetch(origin + route, { headers });
    assert.equal(managerResult.status, 200);
    const text = await managerResult.text();
    assert.match(text, /Research assistant/);
    assert.match(text, /Article author/);
    assert.doesNotMatch(text, /Private instructions/);
    assert.match(managerResult.headers.get("cache-control"), /no-store/);
    for (const principal of [f.author, f.successor]) {
      const s = f.control.session(principal);
      const result = await fetch(origin + route, {
        headers: { Cookie: "wiki_session=" + s.token },
      });
      assert.equal(result.status, 404);
      assert.doesNotMatch(
        await result.text(),
        /Research assistant|Article author/,
      );
    }
  }
  const denied = await fetch(origin + "/api/access", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ principal: f.agent.id, role: "editor" }),
  });
  assert.equal(denied.status, 403);
  assert.equal(f.control.role(f.agent.id), null);
  f.control.grant(f.manager, f.successor, "manager");
  f.control.grant(f.successor, f.manager, "reader");
  assert.equal((await fetch(origin + "/api/access", { headers })).status, 404);
});
