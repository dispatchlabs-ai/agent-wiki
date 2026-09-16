import { archiveStamp, recordImport } from "../src/trace-metadata.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers.mjs";
import { importTrace, TraceStore } from "../src/traces.mjs";
import {
  indexTraces,
  searchTraces,
  traceProvenance,
} from "../src/trace-search.mjs";

test("logical events paginate independently of growing snapshots and preserve identical branch dialogue", (t) => {
  const repo = fixture(t),
    root = path.join(repo, ".git", "traces"),
    source = path.join(repo, ".git", "source.jsonl");
  const rows = [
    { type: "session", id: "same-session" },
    {
      type: "message",
      id: "event-one",
      parentId: null,
      message: { role: "user", content: "Prototype evidence" },
    },
  ];
  let newest;
  for (let i = 0; i < 25; i++) {
    rows.push({ type: "context", id: `context-${i}` });
    fs.writeFileSync(source, rows.map(JSON.stringify).join("\n"));
    newest = importTrace(root, source, "Growing capture");
    newest.imported_at = `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`;
    fs.writeFileSync(
      path.join(root, newest.id, "metadata.json"),
      JSON.stringify(newest),
    );
  }
  indexTraces(root);
  const result = searchTraces(root, "prototype", { limit: 1 });
  assert.equal(result.results.length, 1);
  assert.equal(result.nextOffset, null);
  assert.equal(result.results[0].snapshot_count, 25);
  assert.equal(result.results[0].provenance.length, 5);
  assert.equal(result.results[0].id, newest.id);
  const citations = [];
  for (let offset = 0; offset < 25; offset += 7) {
    const page = traceProvenance(root, result.results[0].logical_key, {
      limit: 7,
      offset,
    });
    assert.equal(page.total, 25);
    assert.equal(page.snapshot_count, 25);
    citations.push(...page.provenance);
  }
  assert.equal(new Set(citations.map((p) => p.id)).size, 25);
  rows.push(
    {
      type: "message",
      id: "event-two",
      parentId: "event-one",
      message: { role: "user", content: "Prototype evidence" },
    },
    {
      type: "message",
      id: "other-branch",
      parentId: "event-one",
      message: { role: "user", content: "Prototype evidence" },
    },
  );
  fs.writeFileSync(source, rows.map(JSON.stringify).join("\n"));
  importTrace(root, source, "Repeated and branched");
  indexTraces(root);
  assert.equal(searchTraces(root, "prototype").results.length, 3);
  const seen = new Set();
  for (let offset = 0; offset < 3; offset++) {
    const r = searchTraces(root, "prototype", { limit: 1, offset });
    seen.add(r.results[0].logical_key);
    assert.equal(r.nextOffset, offset === 2 ? null : offset + 1);
  }
  assert.equal(seen.size, 3);
});
test("fallback grouping requires a verified identical prefix and a session identity", (t) => {
  const repo = fixture(t),
    root = path.join(repo, ".git", "traces"),
    source = path.join(repo, ".git", "source.jsonl");
  const header = { type: "session_meta", payload: { id: "fallback" } },
    event = {
      type: "event_msg",
      payload: { type: "user_message", message: "Equal dialogue" },
    };
  for (const rows of [
    [header, event],
    [header, event, { type: "context" }],
    [header, { type: "context", branch: "different" }, event],
    [{ type: "session_meta", payload: {} }, event],
    [{ type: "session_meta", payload: {} }, event, { type: "context" }],
  ]) {
    fs.writeFileSync(source, rows.map(JSON.stringify).join("\n"));
    importTrace(root, source, "Synthetic");
  }
  indexTraces(root);
  const result = searchTraces(root, "Equal");
  assert.equal(result.results.length, 4);
  assert.deepEqual(
    result.results.map((r) => r.snapshot_count).sort(),
    [1, 1, 1, 2],
  );
});
test("catalog index pages independently, follows imports and removals, and rebuilds after corruption", (t) => {
  const repo = fixture(t),
    root = path.join(repo, ".git", "traces"),
    source = path.join(repo, ".git", "source.jsonl");
  const store = new TraceStore(root);
  t.after(() => store.close());
  fs.writeFileSync(source, JSON.stringify({ type: "session", id: "s" }));
  const a = importTrace(root, source, "One");
  const options = { limit: 1, offset: 0, format: "", session_id: "" };
  assert.equal(store.catalogPage(options, true).total, 1);
  fs.appendFileSync(source, "\n{}");
  importTrace(root, source, "Two");
  assert.equal(store.catalogPage(options, true).sessions[0].snapshot_count, 2);
  fs.writeFileSync(
    path.join(root, "search.sqlite3"),
    "unrelated corrupt search",
  );
  assert.equal(store.catalogPage(options).total, 2);
  fs.rmSync(path.join(root, a.id), { recursive: true });
  assert.equal(store.catalogPage(options).total, 1);
  const originalRead = fs.readFileSync;
  fs.readFileSync = (file, ...args) => {
    if (String(file).endsWith("metadata.json"))
      throw Error("Warm catalog scanned source metadata");
    return originalRead(file, ...args);
  };
  try {
    assert.equal(store.catalogPage(options).total, 1);
  } finally {
    fs.readFileSync = originalRead;
  }
  fs.writeFileSync(
    path.join(root, ".metadata", "catalog.sqlite3"),
    "corrupt metadata projection",
  );
  assert.equal(store.catalogPage(options).total, 1);
});

test("overlapping metadata updates cannot certify an incomplete catalog", (t) => {
  const repo = fixture(t),
    root = path.join(repo, ".git", "traces"),
    source = path.join(repo, ".git", "capture.jsonl");
  fs.mkdirSync(root);
  const store = new TraceStore(root);
  t.after(() => store.close());
  const options = { limit: 20, offset: 0 };
  assert.equal(store.catalogPage(options).total, 0);
  const before = archiveStamp(root);
  const indexFile = path.join(root, ".metadata", "catalog.sqlite3"),
    initial = fs.readFileSync(indexFile);
  const values = [];
  for (const id of ["a", "b"]) {
    fs.writeFileSync(source, JSON.stringify({ type: "session", id }));
    values.push(importTrace(root, source, id));
  }
  // Reproduce both directories landing before either updater observes the same old stamp.
  fs.writeFileSync(indexFile, initial);
  recordImport(root, values[0], before);
  recordImport(root, values[1], before);
  assert.equal(store.catalogPage(options).total, 2);
  assert.equal(store.catalogPage(options, true).total, 2);
});
