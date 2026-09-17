import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { ControlStore } from "../src/control-store.mjs";
import { createWiki } from "../src/server.mjs";
import { markdown } from "../src/git-wiki.mjs";
import { markdownParser } from "../src/markdown-structure.mjs";
import { importTrace, TraceStore } from "../src/traces.mjs";
import { fixture, commit } from "./helpers.mjs";

const conversation = "chat-" + "a".repeat(24);
async function setup(t, external = false) {
  const repo = fixture(t);
  const control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  const owner = control.bootstrap({
    issuer: "https://identity.example.invalid",
    subject: "owner",
    name: "Synthetic owner",
  });
  const session = control.session(owner);
  const data = {
    id: conversation,
    title: "Synthetic conversation",
    kind: "dialogue",
    messages: [],
    counts: {},
    total: 0,
    offset: 0,
    limit: 100,
    previousOffset: null,
    nextOffset: null,
    results: [],
    items: [],
  };
  let provider;
  let trace;
  const traces = path.join(repo, ".git/traces");
  if (external) {
    provider = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
  } else {
    const source = path.join(repo, ".git/source.jsonl");
    fs.writeFileSync(source, '{"type":"session","id":"synthetic"}\n');
    trace = importTrace(traces, source, "Synthetic conversation");
  }
  const app = createWiki({
    repo,
    control,
    origin: "https://wiki.example.invalid",
    traces: external ? null : traces,
    evidenceUrl: external
      ? `http://127.0.0.1:${provider.address().port}/`
      : null,
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(async () => {
    for (const server of [app, provider]) {
      if (!server) continue;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    control.close();
  });
  const request = (route) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            hostname: "127.0.0.1",
            port: app.address().port,
            path: route,
            headers: {
              Host: "wiki.example.invalid",
              Cookie: `wiki_session=${session.token}`,
            },
          },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                body: Buffer.concat(chunks).toString(),
              }),
            );
          },
        )
        .on("error", reject);
    });
  return { repo, control, owner, session, data, trace, request };
}

test("provider JSON and article metadata cannot select local files or cleanup paths", async (t) => {
  const f = await setup(t, true);
  const directory = path.join(f.repo, ".git/disposable");
  fs.mkdirSync(directory);
  const filename = path.join(directory, "sentinel.txt");
  const sentinel = "Synthetic private file, never an API response.";
  fs.writeFileSync(filename, sentinel);
  const fields = {
    transport: "file",
    path: filename,
    directory,
    size: sentinel.length,
  };
  Object.assign(f.data, fields);
  fs.writeFileSync(
    path.join(f.repo, "wiki/guide.md"),
    markdown(
      {
        title: "Guide",
        description: "Synthetic metadata",
        ...fields,
      },
      "Article body.",
    ),
  );
  commit(f.repo, "Add ordinary metadata");
  for (const route of [
    `/api/traces/${conversation}.json`,
    `/conversations/${conversation}/dialogue.json`,
    "/api/traces/catalog.json",
    "/api/traces/search?q=synthetic",
    "/api/articles/guide/current.json",
  ]) {
    const response = await f.request(route);
    assert.equal(response.status, 200);
    const value = JSON.parse(response.body);
    for (const [key, expected] of Object.entries(fields))
      assert.equal(value[key], expected);
    assert.equal(fs.readFileSync(filename, "utf8"), sentinel);
  }
});

test("verified source ranges stream normally and clean up after late revocation", async (t) => {
  const f = await setup(t);
  const original = TraceStore.prototype.spoolLines;
  const directories = new Set();
  t.after(() => {
    for (const directory of directories)
      fs.rmSync(directory, { recursive: true, force: true });
  });
  let spool;
  let revoke = false;
  t.mock.method(TraceStore.prototype, "spoolLines", async function (...args) {
    spool = await original.apply(this, args);
    directories.add(spool.directory);
    if (revoke) f.control.logout(f.session.token);
    return spool;
  });
  const route = `/api/traces/${f.trace.id}/lines.json?start=1&end=1`;
  const response = await f.request(route);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).lines[0].value.id, "synthetic");
  // An HTTP response can finish before asynchronous spool cleanup completes.
  for (let i = 0; i < 100 && fs.existsSync(spool.directory); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(spool.directory), false);
  revoke = true;
  const denied = await f.request(route);
  assert.equal(denied.status, 404);
  assert.doesNotMatch(denied.body, /synthetic/);
  assert.equal(fs.existsSync(spool.directory), false);
});

for (const external of [false, true]) {
  test(`${external ? "external" : "imported"} conversation citations reuse unchanged articles and follow committed edits`, async (t) => {
    const f = await setup(t, external);
    const target = external
      ? `/conversations/${conversation}/`
      : `/traces/${f.trace.id}/`;
    const filename = path.join(f.repo, "wiki/guide.md");
    const other = path.join(f.repo, "wiki/other.md");
    const unrelatedBody =
      "Unchanged text with **formatting** and no citations.";
    fs.writeFileSync(
      filename,
      markdown(
        { title: "Original citation", description: "Synthetic" },
        `[source][decision]\n\n[decision]: ${target}#line-1`,
      ),
    );
    fs.writeFileSync(
      other,
      markdown({ title: "Other", description: "Synthetic" }, unrelatedBody),
    );
    commit(f.repo, "Cite original evidence");
    assert.match((await f.request(target)).body, /Original citation/);
    const parse = t.mock.method(markdownParser, "parse");
    for (let i = 0; i < 2; i++) {
      const response = await f.request(target);
      assert.equal(response.status, 200);
      assert.match(response.body, /Original citation/);
    }
    assert.equal(
      parse.mock.callCount(),
      0,
      "warm conversation reads must not reparse articles",
    );
    fs.writeFileSync(
      filename,
      markdown(
        {
          title: "Updated citation",
          description: "Synthetic",
          sources: [{ url: target }],
        },
        "Citation now comes from metadata.",
      ),
    );
    commit(f.repo, "Change source metadata and title");
    const changed = await f.request(target);
    assert.match(changed.body, /Updated citation/);
    assert.doesNotMatch(changed.body, /Original citation/);
    assert.equal(
      parse.mock.calls.filter((call) => call.arguments[0] === unrelatedBody)
        .length,
      0,
    );
    fs.appendFileSync(filename, "\nUncommitted text.");
    assert.match((await f.request(target)).body, /Updated citation/);
    fs.writeFileSync(
      filename,
      markdown(
        { title: "Updated citation", description: "Synthetic" },
        "No citations now.",
      ),
    );
    commit(f.repo, "Remove the source link");
    assert.doesNotMatch(
      (await f.request(target)).body,
      /Updated citation|Cited by/,
    );
    fs.writeFileSync(
      filename,
      markdown(
        {
          title: "Updated citation",
          description: "Synthetic",
          evidence: [{ url: target + "#line-1", quote: "Recorded text" }],
        },
        "A structured citation.",
      ),
    );
    commit(f.repo, "Add a structured citation");
    assert.match((await f.request(target)).body, /Updated citation/);
    fs.unlinkSync(filename);
    commit(f.repo, "Remove citing article");
    assert.doesNotMatch(
      (await f.request(target)).body,
      /Updated citation|Cited by/,
    );
  });
}
