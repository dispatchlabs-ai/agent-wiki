// @ts-check
// Independently rebuildable catalog projection; never shares the dialogue DB.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const VERSION = 1;
const filename = (root) => path.join(root, ".metadata", "catalog.sqlite3");
export const archiveStamp = (root) => {
  try {
    return fs.statSync(root, { bigint: true }).mtimeNs.toString();
  } catch {
    return null;
  }
};
export function scanMetadata(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((id) => /^[a-f0-9]{64}$/.test(id))
    .map((id) => {
      const m = JSON.parse(
        fs.readFileSync(path.join(root, id, "metadata.json"), "utf8"),
      );
      if (m.id !== id || !["codex", "pi"].includes(m.format))
        throw Error("Invalid trace metadata");
      return { ...m, url: `/traces/${id}/` };
    });
}
function insert(db, m) {
  const sid =
    typeof m.session_id === "string" && m.session_id ? m.session_id : null;
  const key = JSON.stringify([m.format, sid, sid ? null : m.id]);
  db.prepare("INSERT OR REPLACE INTO snapshots VALUES(?,?,?,?,?,?,?)").run(
    m.id,
    m.format,
    sid,
    m.title,
    m.imported_at,
    key,
    JSON.stringify({ ...m, url: `/traces/${m.id}/` }),
  );
}
export function rebuildMetadata(root) {
  fs.mkdirSync(path.dirname(filename(root)), { recursive: true });
  const temporary = filename(root) + "." + randomUUID();
  try {
    const before = archiveStamp(root),
      db = new DatabaseSync(temporary);
    try {
      db.exec(
        "CREATE TABLE control(version INTEGER,stamp TEXT); CREATE TABLE snapshots(id TEXT PRIMARY KEY,format TEXT,session_id TEXT,title TEXT,imported_at TEXT,group_key TEXT,data TEXT); CREATE INDEX catalog_order ON snapshots(imported_at DESC,id); CREATE INDEX catalog_session ON snapshots(format,session_id,imported_at DESC); BEGIN",
      );
      for (const m of scanMetadata(root)) insert(db, m);
      if (archiveStamp(root) !== before)
        throw Error("Trace archive changed while rebuilding catalog; retry");
      db.prepare("INSERT INTO control VALUES(?,?)").run(VERSION, before);
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    fs.renameSync(temporary, filename(root));
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export function recordImport(root, m, _before) {
  if (!fs.existsSync(filename(root))) return;
  let db;
  try {
    db = new DatabaseSync(filename(root));
    db.exec("PRAGMA busy_timeout=100; BEGIN IMMEDIATE");
    const control = db.prepare("SELECT * FROM control").get();
    if (control?.version !== VERSION) return;
    insert(db, m);
    // A root timestamp cannot prove that this was the only concurrent import.
    // Only a complete stable scan may certify the projection as current.
    db.exec("UPDATE control SET stamp=NULL");
    db.exec("COMMIT");
  } catch {
    /* Imports remain durable when this disposable index is unavailable. */
  } finally {
    db?.close();
  }
}
function open(root) {
  if (!root || !fs.existsSync(root)) return null;
  let db;
  try {
    db = new DatabaseSync(filename(root), { readOnly: true });
    db.exec("PRAGMA busy_timeout=100");
    const c = db.prepare("SELECT * FROM control").get();
    if (c?.version === VERSION && c.stamp === archiveStamp(root)) {
      db.prepare("SELECT id FROM snapshots LIMIT 1").get();
      return db;
    }
  } catch {
    /* Missing, stale or corrupt projections are rebuilt independently. */
  }
  db?.close();
  rebuildMetadata(root);
  return new DatabaseSync(filename(root), { readOnly: true });
}
export function metadataCatalog(root, options = null, grouped = false) {
  const db = open(root);
  const key = grouped ? "sessions" : "snapshots";
  if (!db) return options ? { [key]: [], total: 0, nextOffset: null } : [];
  try {
    if (!options)
      return db
        .prepare("SELECT data FROM snapshots ORDER BY title,id")
        .all()
        .map((r) => JSON.parse(String(r.data)));
    const { format = "", session_id = "", limit = 20, offset = 0 } = options;
    const where = "(?='' OR format=?) AND (?='' OR session_id=?)",
      args = [format, format, session_id, session_id];
    const total = db
      .prepare(
        `SELECT COUNT(${grouped ? "DISTINCT group_key" : "*"}) AS total FROM snapshots WHERE ${where}`,
      )
      .get(...args).total;
    const rows = grouped
      ? db
          .prepare(
            `WITH ranked AS (SELECT *,COUNT(*) OVER(PARTITION BY group_key) AS snapshot_count,ROW_NUMBER() OVER(PARTITION BY group_key ORDER BY imported_at DESC,id) AS n FROM snapshots WHERE ${where}) SELECT * FROM ranked WHERE n=1 ORDER BY imported_at DESC,id LIMIT ? OFFSET ?`,
          )
          .all(...args, limit, offset)
      : db
          .prepare(
            `SELECT data FROM snapshots WHERE ${where} ORDER BY imported_at DESC,id LIMIT ? OFFSET ?`,
          )
          .all(...args, limit, offset);
    return {
      [key]: rows.map((r) =>
        grouped
          ? {
              format: r.format,
              session_id: r.session_id,
              latest: JSON.parse(String(r.data)),
              snapshot_count: r.snapshot_count,
            }
          : JSON.parse(String(r.data)),
      ),
      total,
      nextOffset: offset + limit < total ? offset + limit : null,
    };
  } finally {
    db.close();
  }
}
