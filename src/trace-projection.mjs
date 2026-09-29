// Disposable serving indexes; original trace paths and bytes remain authoritative.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import {
  archiveStamp,
  scanMetadata,
  rebuildMetadata,
} from "./trace-metadata.mjs";
import {
  indexTraces,
  SEARCH_VERSION,
  traceSearchHealth,
} from "./trace-search.mjs";

function validate(root, catalog) {
  const db = new DatabaseSync(path.join(root, "search.sqlite3"));
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw Error("Corrupt trace index");
    if (db.prepare("SELECT value FROM version").get()?.value !== SEARCH_VERSION)
      throw Error("Incompatible trace index");
    const indexed = db
      .prepare(
        "SELECT id,title,format,session_id,imported_at FROM snapshots ORDER BY id",
      )
      .all();
    const expected = catalog
      .map((m) => ({
        id: m.id,
        title: m.title,
        format: m.format,
        session_id: typeof m.session_id === "string" ? m.session_id : null,
        imported_at: m.imported_at,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (JSON.stringify(indexed) !== JSON.stringify(expected))
      throw Error("Stale trace index");
    db.exec("INSERT INTO dialogue(dialogue) VALUES('integrity-check')");
  } finally {
    db.close();
  }
  if (traceSearchHealth(root).state !== "ready")
    throw Error("Trace index is not ready");
}

export async function prepareTraceProjection(
  archive,
  parent,
  authorityRoot = archive,
) {
  if (!path.isAbsolute(parent))
    throw Error("Trace index parent must be absolute");
  parent = path.resolve(parent);
  archive = fs.realpathSync(archive);
  authorityRoot = fs.realpathSync(authorityRoot);
  for (
    let part = path.resolve(parent);
    part !== path.dirname(part);
    part = path.dirname(part)
  ) {
    if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink())
      throw Error("Trace index parent must not contain symlinks");
  }
  const related = (a, b) => a === b || a.startsWith(b + path.sep);
  if (related(parent, authorityRoot) || related(authorityRoot, parent))
    throw Error("Trace projection overlaps its archive");
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  parent = fs.realpathSync(parent);
  if (related(parent, authorityRoot) || related(authorityRoot, parent))
    throw Error("Trace projection overlaps its archive");
  const parentStat = fs.statSync(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.uid !== process.getuid() ||
    parentStat.mode & 0o022
  )
    throw Error(
      "Trace index parent must be owned by the server and not writable by other users",
    );
  const root = fs.mkdtempSync(path.join(parent, "serving-"));
  fs.chmodSync(root, 0o700);
  try {
    const catalog = scanMetadata(archive);
    try {
      const source = new DatabaseSync(path.join(archive, "search.sqlite3"), {
        readOnly: true,
      });
      try {
        await backup(source, path.join(root, "search.sqlite3"));
      } finally {
        source.close();
      }
      validate(root, catalog);
    } catch {
      for (const suffix of ["", "-wal", "-shm"])
        fs.rmSync(path.join(root, "search.sqlite3" + suffix), { force: true });
      indexTraces(archive, root);
      validate(root, catalog);
    }
    // Opening a WAL source can create disposable SQLite sidecars and change
    // the directory timestamp. Verify original membership/metadata separately.
    if (JSON.stringify(scanMetadata(archive)) !== JSON.stringify(catalog))
      throw Error("Trace archive changed during projection");
    const stamp = archiveStamp(archive);
    rebuildMetadata(archive, root);
    if (archiveStamp(archive) !== stamp)
      throw Error("Trace archive changed during projection");
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
