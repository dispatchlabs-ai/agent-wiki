// @ts-check
import { scanMetadata } from "./trace-metadata.mjs";
// Disposable dialogue index. Original JSONL remains the only trace authority.
import { createHash } from "node:crypto";
import { WikiError } from "./errors.mjs";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parseRecords,
  digest,
  MAX_TRACE_BYTES,
  TRACE_PAGE_SIZE,
} from "./traces.mjs";
import { project } from "./trace-format.mjs";
export const SEARCH_VERSION = 3;
const filename = (root) => path.join(root, "search.sqlite3");
function logicalEventKey(event, metadata, prefix) {
  const r = event.value,
    p = r.payload || {};
  const native = metadata.format === "pi" ? r.id : p.item?.id || p.id;
  const session =
    typeof metadata.session_id === "string" && metadata.session_id;
  // A byte-identical prefix proves shared lineage; equal text alone does not.
  const identity = !session
    ? [metadata.id, event.line]
    : typeof native === "string" && native
      ? ["native", native]
      : ["prefix", prefix];
  return digest(
    Buffer.from(
      JSON.stringify([metadata.format, session || null, ...identity]),
    ),
  );
}
export function indexTraces(root) {
  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(filename(root));
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS version(value INTEGER)",
    );
    db.exec("BEGIN IMMEDIATE");
    if (
      db.prepare("SELECT value FROM version").get()?.value !== SEARCH_VERSION
    ) {
      db.exec(
        "DROP TABLE IF EXISTS evidence; DROP TABLE IF EXISTS snapshots; DROP TABLE IF EXISTS dialogue; DELETE FROM version;",
      );
      db.prepare("INSERT INTO version VALUES(?)").run(SEARCH_VERSION);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS evidence(logical_key TEXT,snapshot TEXT,line INTEGER,page INTEGER,PRIMARY KEY(logical_key,snapshot,line));
      CREATE INDEX IF NOT EXISTS evidence_snapshot ON evidence(snapshot);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,title TEXT,format TEXT,session_id TEXT,imported_at TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS dialogue USING fts5(snapshot UNINDEXED,line UNINDEXED,page UNINDEXED,role UNINDEXED,logical_key UNINDEXED,text);`);
    const catalog = scanMetadata(root);
    const ids = new Set(catalog.map((m) => m.id));
    for (const { id } of db.prepare("SELECT id FROM snapshots").all()) {
      if (ids.has(id)) continue;
      db.prepare("DELETE FROM dialogue WHERE snapshot=?").run(id);
      db.prepare("DELETE FROM evidence WHERE snapshot=?").run(id);
      db.prepare("DELETE FROM snapshots WHERE id=?").run(id);
    }
    let added = 0;
    for (const m of catalog) {
      if (db.prepare("SELECT 1 FROM snapshots WHERE id=?").get(m.id)) continue;
      const source = path.join(root, m.id, "source.jsonl");
      if (fs.statSync(source).size > MAX_TRACE_BYTES)
        throw Error("Trace exceeds 128 MiB");
      const bytes = fs.readFileSync(source);
      if (digest(bytes) !== m.id) throw Error("Trace integrity check failed");
      const records = parseRecords(bytes),
        events = project(records, m.format);
      const prefixes = new Map(),
        hash = createHash("sha256");
      let at = 0,
        line = 1;
      for (let i = 0; i <= bytes.length; i++)
        if (i === bytes.length || bytes[i] === 10) {
          hash.update(bytes.subarray(at, i));
          prefixes.set(line, hash.copy().digest("hex"));
          if (i < bytes.length) hash.update(bytes.subarray(i, i + 1));
          line++;
          at = i + 1;
        }
      db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)").run(
        m.id,
        m.title,
        m.format,
        typeof m.session_id === "string" ? m.session_id : null,
        m.imported_at,
      );
      const insert = db.prepare("INSERT INTO dialogue VALUES(?,?,?,?,?,?)");
      events.forEach((event, i) => {
        if (
          !["user", "assistant"].includes(event.kind) ||
          event.mirrorOf ||
          event.superseded
        )
          return;
        const text = event.blocks?.length
          ? event.blocks
              .filter((b) => b.type === "text")
              .map((b) => b.text || "")
              .join("\n")
          : event.text;
        if (text) {
          const key = logicalEventKey(event, m, prefixes.get(event.line));
          db.prepare("INSERT OR IGNORE INTO evidence VALUES(?,?,?,?)").run(
            key,
            m.id,
            event.line,
            Math.floor(i / TRACE_PAGE_SIZE) + 1,
          );
          insert.run(
            m.id,
            event.line,
            Math.floor(i / TRACE_PAGE_SIZE) + 1,
            event.kind,
            key,
            text,
          );
        }
      });
      added++;
    }
    db.exec("COMMIT");
    return { snapshots: catalog.length, added };
  } finally {
    db.close();
  }
}
/** @returns {import("./contracts.mjs").TraceSearchResult} */
export function searchTraces(
  root,
  query,
  { limit = 20, offset = 0, format = "" } = {},
) {
  if (
    !["", "codex", "pi"].includes(format) ||
    typeof query !== "string" ||
    query.length > 300 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 40 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    throw new WikiError("INVALID_SEARCH", "Invalid trace search");
  const terms = query.match(/[\p{L}\p{N}_-]+/gu) || [];
  if (terms.length > 30)
    throw new WikiError("INVALID_SEARCH", "Too many trace search terms");
  if (!root || !fs.existsSync(filename(root)))
    return { indexed: false, results: [], nextOffset: null };
  const db = new DatabaseSync(filename(root), { readOnly: true });
  try {
    if (db.prepare("SELECT value FROM version").get()?.value !== SEARCH_VERSION)
      return { indexed: false, results: [], nextOffset: null };
    if (!terms.length) return { indexed: true, results: [], nextOffset: null };
    const rows = db
      .prepare(
        `
      WITH matches AS MATERIALIZED (
        SELECT snapshot AS id,line,page,role,logical_key,s.title,s.format,s.session_id,s.imported_at,
          snippet(dialogue,5,'','',' … ',30) AS snippet,rank AS relevance
        FROM dialogue JOIN snapshots s ON s.id=snapshot
        WHERE dialogue MATCH ? AND (?='' OR s.format=?)
      ), ranked AS (
        SELECT *, MIN(relevance) OVER(PARTITION BY logical_key) AS group_rank,
          ROW_NUMBER() OVER(PARTITION BY logical_key ORDER BY imported_at DESC,id DESC,line DESC) AS representative
        FROM matches
      ) SELECT * FROM ranked WHERE representative=1 ORDER BY group_rank,logical_key LIMIT ? OFFSET ?
    `,
      )
      .all(
        terms.map((t) => `"${t}"*`).join(" AND "),
        format,
        format,
        limit + 1,
        offset,
      );

    return {
      indexed: true,
      results: rows.slice(0, limit).map((r) => {
        const { representative, relevance, group_rank, ...rest } = r;
        const hit = {
          id: String(rest.id),
          line: Number(rest.line),
          page: Number(rest.page),
          role: String(rest.role),
          title: String(rest.title),
          format: /** @type {import("./contracts.mjs").Harness} */ (
            rest.format
          ),
          session_id: rest.session_id === null ? null : String(rest.session_id),
          imported_at: String(rest.imported_at),
          snippet: String(rest.snippet),
          logical_key: String(rest.logical_key),
        };
        const evidence = provenancePage(db, hit.logical_key, 5, 0);
        return {
          ...hit,
          url: `/traces/${r.id}/?page=${r.page}#line-${r.line}`,
          snapshot_count: evidence.snapshot_count,
          provenance: evidence.provenance,
          provenance_url: `/api/traces/provenance.json?key=${hit.logical_key}`,
          provenance_nextOffset: evidence.nextOffset,
        };
      }),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  } finally {
    db.close();
  }
}

function provenancePage(db, key, limit, offset) {
  const counts = db
    .prepare(
      "SELECT COUNT(*) AS total,COUNT(DISTINCT snapshot) AS snapshot_count FROM evidence WHERE logical_key=?",
    )
    .get(key);
  const total = Number(counts.total);
  const provenance = db
    .prepare(
      `SELECT s.id,s.imported_at,e.line,e.page FROM evidence e JOIN snapshots s ON s.id=e.snapshot WHERE e.logical_key=? ORDER BY s.imported_at DESC,s.id DESC,e.line LIMIT ? OFFSET ?`,
    )
    .all(key, limit, offset)
    .map((p) => ({
      id: String(p.id),
      line: Number(p.line),
      page: Number(p.page),
      imported_at: String(p.imported_at),
      url: `/traces/${p.id}/?page=${p.page}#line-${p.line}`,
    }));
  return {
    provenance,
    total,
    snapshot_count: Number(counts.snapshot_count),
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}
export function traceProvenance(root, key, { limit = 20, offset = 0 } = {}) {
  if (
    !/^[a-f0-9]{64}$/.test(key) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new WikiError("INVALID_PROVENANCE", "Invalid trace provenance range");
  if (!root || !fs.existsSync(filename(root)))
    throw new WikiError(
      "SEARCH_UNAVAILABLE",
      "Trace search index has not been built",
      503,
    );
  const db = new DatabaseSync(filename(root), { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=100");
    if (db.prepare("SELECT value FROM version").get()?.value !== SEARCH_VERSION)
      throw new WikiError(
        "SEARCH_UNAVAILABLE",
        "Trace search index needs rebuilding",
        503,
      );
    return { logical_key: key, ...provenancePage(db, key, limit, offset) };
  } finally {
    db.close();
  }
}

export function traceSearchHealth(root) {
  if (!root) return { state: "disabled" };
  if (!fs.existsSync(filename(root)))
    return { state: "missing", error: "Trace search index has not been built" };
  let db;
  try {
    db = new DatabaseSync(filename(root), { readOnly: true });
    db.exec("PRAGMA busy_timeout=100");
    if (db.prepare("SELECT value FROM version").get()?.value !== SEARCH_VERSION)
      return {
        state: "incompatible",
        error: "Trace search index needs rebuilding",
      };
    db.prepare("SELECT rowid FROM dialogue LIMIT 1").get();
    db.prepare("SELECT logical_key FROM evidence LIMIT 1").get();
    return { state: "ready" };
  } catch (e) {
    return { state: "degraded", error: e.message };
  } finally {
    db?.close();
  }
}
