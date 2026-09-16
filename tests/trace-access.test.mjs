import { Readable } from "node:stream";
import { spoolTraceLines } from "../src/trace-lines.mjs";
import { MAX_TRACE_BYTES } from "../src/traces.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers.mjs";
import { importTrace, TraceStore } from "../src/traces.mjs";
import {
  sessions,
  sortedSnapshots,
  catalogOptions,
  catalogPage,
} from "../src/trace-catalog.mjs";

function archive(t, content) {
  const repo = fixture(t),
    root = path.join(repo, ".git", "traces"),
    source = path.join(repo, "source.jsonl");
  fs.writeFileSync(source, content);
  const metadata = importTrace(root, source, "Synthetic evidence"),
    store = new TraceStore(root);
  t.after(() => store.close());
  return { root, metadata, store };
}
test("source ranges retain blank lines, CRLF, Unicode and correct record-page citations without rendering", async (t) => {
  const rows = [
    JSON.stringify({ type: "session", id: "shared" }),
    "",
    ...Array.from({ length: 101 }, (_, i) =>
      JSON.stringify({
        type: "message",
        message: { role: "user", content: `Evidence ${i} 🌱` },
      }),
    ),
  ];
  const { store, metadata } = archive(t, rows.join("\r\n") + "\r\n");
  const first = await store.readLines(metadata.id, 1, 3);
  assert.equal(first.total_lines, 103);
  assert.equal(first.lines[1].raw, "\r");
  assert.equal(first.lines[1].value, null);
  assert.equal(first.lines[1].url, null);
  assert.equal(first.lines[2].value.message.content, "Evidence 0 🌱");
  assert.equal(first.nextStart, 4);
  const tail = await store.readLines(metadata.id, 100, 110);
  assert.equal(tail.end, 103);
  assert.equal(tail.nextStart, null);
  assert.match(tail.lines.find((l) => l.line === 102).url, /page=2#line-102$/);
  assert.equal(tail.html, undefined);
  assert.equal(store.renders, 0);
  const rendered = await store.read(metadata.id, 2);
  assert.ok(rendered.records.some((r) => r.line === 102));
  assert.equal(await store.readLines(metadata.id, 104, 104), null);
  assert.equal((await store.readLines(metadata.id, 1, 103)).lines.length, 103);
  for (const [start, end] of [
    [0, 1],
    [2, 1],
    [1.5, 2],
  ])
    await assert.rejects(
      store.readLines(metadata.id, start, end),
      (e) => e.code === "INVALID_RANGE",
    );
});
test("caller-selected ranges return large records in full and stream unselected lines", async (t) => {
  const header = JSON.stringify({ type: "session", id: "large" }),
    large = JSON.stringify({
      type: "message",
      message: { role: "user", content: "x".repeat(300000) },
    });
  const { store, metadata } = archive(
    t,
    header +
      "\n" +
      large +
      "\n" +
      JSON.stringify({
        type: "message",
        message: { role: "user", content: "Last" },
      }),
  );
  const selected = await store.readLines(metadata.id, 2, 2);
  assert.equal(selected.lines[0].raw, large);
  assert.equal(selected.lines[0].value.message.content, "x".repeat(300000));
  const tail = await store.readLines(metadata.id, 3, 3);
  assert.equal(tail.lines[0].value.message.content, "Last");
  assert.equal(tail.total_lines, 3);
  assert.equal(store.renders, 0);
});
test("range reads verify the complete source including bytes outside the selection", async (t) => {
  const { store, metadata, root } = archive(
    t,
    JSON.stringify({ type: "session", id: "integrity" }) + "\n{}",
  );
  const filename = path.join(root, metadata.id, "source.jsonl");
  fs.chmodSync(filename, 0o644);
  fs.appendFileSync(filename, "\n{}");
  await assert.rejects(store.readLines(metadata.id, 1, 1), /integrity/);
});
test("session grouping isolates harnesses and absent identities, retaining all growing snapshots", () => {
  const make = (id, format, session_id, imported_at) => ({
    id,
    format,
    session_id,
    imported_at,
    title: id,
  });
  const catalog = [
    make("a", "pi", "shared", "2026-01-01"),
    make("b", "pi", "shared", "2026-01-02"),
    make("c", "codex", "shared", "2026-01-03"),
    make("d", "pi", null, "2026-01-04"),
    make("e", "pi", null, "2026-01-05"),
  ];
  const grouped = sessions(catalog);
  assert.equal(grouped.length, 4);
  const pi = grouped.find(
    (g) => g.session_id === "shared" && g.format === "pi",
  );
  assert.equal(pi.latest.id, "b");
  assert.equal(pi.snapshot_count, 2);
  const options = catalogOptions(
    new URLSearchParams({ format: "pi", session_id: "shared", limit: "1" }),
  );
  assert.deepEqual(
    sortedSnapshots(catalog, options).map((t) => t.id),
    ["b", "a"],
  );
  assert.equal(
    catalogPage(sortedSnapshots(catalog, options), options, "snapshots")
      .nextOffset,
    1,
  );
  assert.throws(
    () => catalogOptions(new URLSearchParams({ limit: "101" })),
    /Invalid/,
  );
});

test("large explicit ranges are disk-spooled without entering the rendered cache", async (t) => {
  const body = "x".repeat(4 * 1024 * 1024);
  const { store, metadata } = archive(
    t,
    JSON.stringify({ type: "session", id: "spool" }) +
      "\n" +
      JSON.stringify({
        type: "message",
        message: { role: "user", content: body },
      }),
  );
  const result = await store.spoolLines(metadata.id, 1, 2);
  try {
    assert.equal(result.transport, "file");
    assert.ok(result.size > 8 * 1024 * 1024);
    assert.equal(store.cache.size, 0);
    assert.equal(store.bytes, 0);
    assert.equal(
      JSON.parse(fs.readFileSync(result.path, "utf8")).lines[1].value.message
        .content,
      body,
    );
  } finally {
    fs.rmSync(result.directory, { recursive: true, force: true });
  }
});

test("range verification enforces the archive limit before and during streaming", async (t) => {
  const { root, metadata } = archive(
    t,
    JSON.stringify({ type: "session", id: "size" }),
  );
  const source = path.join(root, metadata.id, "source.jsonl"),
    directory = path.join(root, "spool-limit");
  fs.mkdirSync(directory);
  fs.chmodSync(source, 0o600);
  fs.truncateSync(source, MAX_TRACE_BYTES + 1);
  await assert.rejects(
    spoolTraceLines(root, metadata, 1, 1, directory),
    /exceeds 128 MiB/,
  );
  assert.deepEqual(fs.readdirSync(directory), []);
  fs.truncateSync(source, 1);
  const original = fs.createReadStream;
  fs.createReadStream = (file, options) =>
    String(file) === source
      ? Readable.from(
          (function* () {
            const chunk = Buffer.alloc(1024 * 1024);
            for (let i = 0; i < 129; i++) yield chunk;
          })(),
        )
      : original(file, options);
  try {
    await assert.rejects(
      spoolTraceLines(root, metadata, 1, 1, directory),
      /exceeds 128 MiB/,
    );
    assert.ok(
      fs.statSync(path.join(directory, "verified.jsonl")).size <=
        MAX_TRACE_BYTES,
    );
    assert.equal(fs.existsSync(path.join(directory, "response.json")), false);
  } finally {
    fs.createReadStream = original;
  }
});
