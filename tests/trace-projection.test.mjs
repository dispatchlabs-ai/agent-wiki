import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { prepareTraceProjection } from "../src/trace-projection.mjs";
import {
  indexTraces,
  searchTraces,
  traceProvenance,
} from "../src/trace-search.mjs";
import { importTrace, TraceStore } from "../src/traces.mjs";
function fixture(t) {
  const tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "wiki-projection-")),
  );
  const archive = path.join(tmp, "authority", "traces"),
    cache = path.join(tmp, "cache");
  const metadata = importTrace(
    archive,
    new URL("../examples/traces/codex.jsonl", import.meta.url),
    "Synthetic",
  );
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return { tmp, archive, cache, metadata };
}
test("local projection preserves search, provenance, grouped catalog and original bytes through replacement", async (t) => {
  const { archive, cache, metadata } = fixture(t);
  indexTraces(archive);
  const original = fs.readFileSync(
    path.join(archive, metadata.id, "source.jsonl"),
  );
  const expected = searchTraces(archive, "prototype");
  assert.ok(expected.results.length > 0);
  const first = await prepareTraceProjection(archive, cache);
  assert.deepEqual(searchTraces(first, "prototype"), expected);
  for (const hit of expected.results)
    assert.deepEqual(
      traceProvenance(first, hit.logical_key),
      traceProvenance(archive, hit.logical_key),
    );
  const store = new TraceStore(archive, { indexRoot: first });
  const baseline = new TraceStore(archive);
  try {
    assert.deepEqual(
      store.catalogPage({ limit: 20, offset: 0 }, true),
      baseline.catalogPage({ limit: 20, offset: 0 }, true),
    );
    assert.deepEqual(
      await store.readLines(metadata.id, 1, 2),
      await baseline.readLines(metadata.id, 1, 2),
    );
  } finally {
    store.close();
    baseline.close();
  }
  fs.rmSync(first, { recursive: true });
  const second = await prepareTraceProjection(archive, cache);
  assert.notEqual(first, second);
  assert.deepEqual(searchTraces(second, "prototype"), expected);
  assert.deepEqual(
    fs.readFileSync(path.join(archive, metadata.id, "source.jsonl")),
    original,
  );
});
for (const defect of ["missing", "corrupt", "version", "stale"])
  test(`rebuilds ${defect} source cache without altering original evidence`, async (t) => {
    const { archive, cache } = fixture(t);
    if (defect !== "missing") indexTraces(archive);
    const filename = path.join(archive, "search.sqlite3");
    if (defect === "corrupt") fs.writeFileSync(filename, "not SQLite");
    if (["version", "stale"].includes(defect)) {
      const db = new DatabaseSync(filename);
      db.exec(
        defect === "version"
          ? "UPDATE version SET value=-1"
          : "DELETE FROM snapshots",
      );
      db.close();
    }
    const projection = await prepareTraceProjection(archive, cache);
    assert.equal(searchTraces(projection, "prototype").indexed, true);
    const db = new DatabaseSync(path.join(projection, "search.sqlite3"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM snapshots").get().n, 1);
    db.close();
  });
test("rejects overlapping and symlinked projection locations", async (t) => {
  const { tmp, archive, cache } = fixture(t);
  await assert.rejects(
    prepareTraceProjection(archive, path.join(archive, "cache")),
    /overlaps/,
  );
  const link = path.join(tmp, "link");
  fs.symlinkSync(archive, link);
  await assert.rejects(prepareTraceProjection(archive, link), /symlink/);
  await assert.rejects(
    prepareTraceProjection(
      archive,
      path.join(tmp, "authority", "control"),
      path.join(tmp, "authority"),
    ),
    /overlaps/,
  );
  assert.equal(fs.existsSync(cache), false);
});

test("SQLite backup includes committed WAL content without checkpointing source authority", async (t) => {
  const { archive, cache } = fixture(t);
  indexTraces(archive);
  const writer = new DatabaseSync(path.join(archive, "search.sqlite3"));
  try {
    writer.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE dialogue SET text='committed WAL acceptance phrase'",
    );
    const expected = searchTraces(archive, "acceptance");
    assert.ok(expected.results.length > 0);
    const projection = await prepareTraceProjection(archive, cache);
    assert.deepEqual(searchTraces(projection, "acceptance"), expected);
  } finally {
    writer.close();
  }
});

test("archive mutation during SQLite projection fails closed and removes partial cache", async (t) => {
  const { archive, cache } = fixture(t);
  indexTraces(archive);
  const pending = prepareTraceProjection(archive, cache);
  importTrace(
    archive,
    new URL("../examples/traces/pi.jsonl", import.meta.url),
    "Second synthetic snapshot",
  );
  await assert.rejects(pending, /changed|Stale/);
  assert.deepEqual(fs.readdirSync(cache), []);
});

test("direct startup cannot enable projection without managed ownership", (t) => {
  const { archive, cache } = fixture(t);
  const env = {
    ...process.env,
    WIKI_TRACES: archive,
    WIKI_TRACE_INDEX_ROOT: cache,
  };
  for (const key of [
    "WIKI_LIFECYCLE_LOCK_FD",
    "WIKI_LIFECYCLE_LOCK",
    "WIKI_LIFECYCLE_ROOT",
  ])
    delete env[key];
  const child = spawnSync(
    process.execPath,
    [new URL("../src/server.mjs", import.meta.url).pathname],
    { env, encoding: "utf8" },
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /requires managed lifecycle ownership/);
  assert.equal(fs.existsSync(cache), false);
});

test("rejects a cache parent writable by other users", async (t) => {
  const { archive, cache } = fixture(t);
  fs.mkdirSync(cache, { mode: 0o777 });
  fs.chmodSync(cache, 0o777);
  await assert.rejects(
    prepareTraceProjection(archive, cache),
    /not writable by other users/,
  );
  assert.deepEqual(fs.readdirSync(cache), []);
});
