import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  importTrace,
  TraceStore,
  parseRecords,
  digest,
} from "../src/traces.mjs";
import { project } from "../src/trace-worker.mjs";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-traces-"));
  const store = new TraceStore(root);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store };
}
test("Codex imports exact bytes; JIT reads deduplicate concurrent work and reuse cache", async (t) => {
  const { root, store } = fixture(t),
    source = new URL("../examples/traces/codex.jsonl", import.meta.url);
  const metadata = importTrace(root, source, "Codex example");
  assert.equal(metadata.id, digest(fs.readFileSync(source)));
  assert.deepEqual(importTrace(root, source, "different title"), metadata);
  const [a, b] = await Promise.all([
    store.read(metadata.id),
    store.read(metadata.id),
  ]);
  assert.equal(a, b);
  assert.equal(store.renders, 1);
  assert.equal(await store.read(metadata.id), a);
  assert.equal(store.renders, 1);
  assert.match(a.html, /two-week prototype/);
  assert.match(a.html, /Original source record/);
  assert.equal(a.records.find((r) => r.line === 4).mirrorOf, 3);
  assert.equal(a.records.find((r) => r.line === 9).mirrorOf, 8);
  assert.equal(await store.read(metadata.id, 2), null);
  assert.equal(store.renders, 1, "out-of-range pages must not start a worker");
  assert.equal(await store.read("../escape"), null);
});
test("pi preserves alternate branches, reasoning, tool calls and compaction without replaying tails", async (t) => {
  const { root, store } = fixture(t),
    metadata = importTrace(
      root,
      new URL("../examples/traces/pi.jsonl", import.meta.url),
      "pi example",
    );
  const result = await store.read(metadata.id);
  assert.match(result.html, /Branch change/);
  assert.match(result.html, /Thinking/);
  assert.match(result.html, /Tool call/);
  assert.equal(result.records.filter((r) => r.kind === "user").length, 1);
  assert.equal(result.records.find((r) => r.value.id === "b1").parentLine, 2);
  assert.equal(result.records.length, 8);
});
test("invalid records reject import and tampered snapshots fail closed", async (t) => {
  const { root, store } = fixture(t),
    source = path.join(root, "input.jsonl");
  fs.writeFileSync(source, '{"type":"session"}\n{bad}');
  assert.throws(() => importTrace(root, source), /source line 2/);
  fs.writeFileSync(source, '{"type":"session"}\n');
  const metadata = importTrace(root, source);
  const snapshot = path.join(root, metadata.id, "source.jsonl");
  fs.chmodSync(snapshot, 0o644);
  fs.appendFileSync(snapshot, "{}\n");
  await assert.rejects(store.read(metadata.id), /integrity/);
});
test("pagination preserves source line anchors, escapes hostile fields and evicts bounded cache", async (t) => {
  const { root, store } = fixture(t);
  store.maxBytes = 1;
  const source = path.join(root, "input.jsonl");
  fs.writeFileSync(
    source,
    [
      { type: "session", id: "x" },
      ...Array.from({ length: 101 }, (_, i) => ({
        type: "message",
        id: String(i),
        parentId: i ? String(i - 1) : null,
        timestamp: "<script>alert(1)</script>",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "<script>alert(2)</script> [bad](javascript:alert(3))",
            },
          ],
        },
      })),
    ]
      .map(JSON.stringify)
      .join("\n"),
  );
  const metadata = importTrace(root, source, "<img src=x onerror=alert(1)>");
  const result = await store.read(metadata.id, 2);
  assert.equal(result.records.length, 2);
  assert.match(result.html, /id="line-101"/);
  assert.doesNotMatch(
    result.html,
    /<script>alert|<img src=x|href="javascript:/,
  );
  assert.equal(store.cache.size, 0);
});
test("repeated same-stream messages survive, typed history context is labeled and pi revisions retained", () => {
  const parse = (values) =>
    parseRecords(Buffer.from(values.map(JSON.stringify).join("\n")));
  const events = project(
    parse([
      { type: "session_meta" },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "again" },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "again" },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "again" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "again" }],
        },
      },
    ]),
    "codex",
  );
  assert.equal(events[1].mirrorOf, undefined);
  assert.equal(events[2].mirrorOf, undefined);
  assert.equal(events[3].mirrorOf, 2);
  assert.equal(events[4].mirrorOf, 3);
  const typed = project(
    parse([
      { type: "session_meta", payload: { history_mode: "paginated" } },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "context" }],
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: { type: "UserMessage", content: [{ text: "actual prompt" }] },
        },
      },
    ]),
    "codex",
  );
  assert.equal(typed[1].kind, "context");
  assert.equal(typed[2].kind, "user");
  const revisions = project(
    parse([
      { type: "session" },
      { type: "message", id: "a", message: { role: "user", content: "old" } },
      { type: "message", id: "a", message: { role: "user", content: "new" } },
    ]),
    "pi",
  );
  assert.equal(revisions[1].superseded, true);
  assert.equal(revisions[2].superseded, false);
});

test("trace search is rebuildable, incremental and cites matching original lines", async (t) => {
  const { indexTraces, searchTraces } = await import("../src/trace-search.mjs");
  const { root, store } = fixture(t);
  assert.equal(searchTraces(root, "prototype").indexed, false);
  const m = importTrace(
    root,
    new URL("../examples/traces/codex.jsonl", import.meta.url),
  );
  assert.equal(indexTraces(root).added, 1);
  assert.equal(indexTraces(root).added, 0);
  const found = searchTraces(root, "prototype", { limit: 1 });
  assert.equal(found.results.length, 1);
  const hit = found.results[0];
  const page = await store.read(hit.id, hit.page);
  assert.match(page.records.find((r) => r.line === hit.line).text, /prototype/);
  assert.ok(hit.url.endsWith(`#line-${hit.line}`));
  assert.throws(() => searchTraces(root, "x", { limit: 100 }), /Invalid/);
  assert.equal(searchTraces(root, '" OR *').results.length, 0);
  const broken = path.join(root, "broken.jsonl");
  fs.writeFileSync(broken, '{"type":"session","id":"broken"}\n');
  const invalid = importTrace(root, broken);
  const invalidSource = path.join(root, invalid.id, "source.jsonl");
  fs.chmodSync(invalidSource, 0o644);
  fs.appendFileSync(invalidSource, "{}\n");
  assert.throws(() => indexTraces(root), /integrity/);
  assert.deepEqual(searchTraces(root, "prototype", { limit: 1 }), found);
  fs.rmSync(path.join(root, invalid.id), { recursive: true });
  fs.rmSync(path.join(root, "search.sqlite3"));
  assert.equal(indexTraces(root).added, 1);
  assert.deepEqual(searchTraces(root, "prototype", { limit: 1 }), found);
  fs.rmSync(path.join(root, m.id), { recursive: true });
  indexTraces(root);
  assert.equal(searchTraces(root, "prototype").results.length, 0);
});
