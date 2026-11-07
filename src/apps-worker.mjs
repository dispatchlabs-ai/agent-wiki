// This process owns app storage only. It never loads the wiki or identity DB.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync, constants } from "node:sqlite";
import { WikiError } from "./errors.mjs";

const root = process.argv[2];
// Node's supported 24.22/26.12 runtimes include these APIs; the repository's
// older @types/node declaration predates their backport.
const sql = /** @type {typeof constants & Record<string, number>} */ (
  constants
);
const fail = (message, code = "INVALID_APP", status = 400) => {
  throw new WikiError(code, message, status);
};
const slug = (value) => {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    fail("Expected a lowercase hyphenated ID");
  return value;
};
const string = (value, name) => {
  if (typeof value !== "string" || !value.trim()) fail(`${name} is required`);
  return value;
};
const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) =>
  JSON.stringify(value, (_, v) =>
    typeof v === "bigint"
      ? Number.isSafeInteger(Number(v))
        ? Number(v)
        : String(v)
      : v instanceof Uint8Array
        ? { base64: Buffer.from(v).toString("base64") }
        : v,
  );
function database(filename, create = false) {
  if (!fs.existsSync(filename) && !create)
    fail(
      "Application database is missing; restore its durable storage",
      "APP_STORAGE",
      503,
    );
  if (
    fs.existsSync(filename) &&
    (!fs.lstatSync(filename).isFile() ||
      fs.lstatSync(filename).isSymbolicLink())
  )
    fail("Invalid application database", "APP_STORAGE", 503);
  if (!fs.existsSync(filename))
    fs.closeSync(fs.openSync(filename, "wx", 0o600));
  const db =
    /** @type {DatabaseSync & {enableDefensive(enabled: boolean): void, setAuthorizer(callback: ((action: number, first: string, second: string, database: string, trigger: string) => number) | null): void}} */ (
      new DatabaseSync(filename, { allowExtension: false })
    );
  db.enableDefensive(true);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000",
  );
  return db;
}
fs.mkdirSync(path.join(root, "backends"), { recursive: true, mode: 0o700 });
const registryFile = path.join(root, "apps.sqlite3");
if (
  !fs.existsSync(registryFile) &&
  fs.readdirSync(path.join(root, "backends")).length
)
  fail(
    "Application registry is missing; restore its durable storage",
    "APP_STORAGE",
    503,
  );
const registry = database(registryFile, true);
registry.exec(`
  CREATE TABLE IF NOT EXISTS backends(id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, owner TEXT NOT NULL, readers TEXT NOT NULL, writers TEXT NOT NULL, access_revision INTEGER NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pages(id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS versions(page TEXT NOT NULL REFERENCES pages(id) DEFERRABLE INITIALLY DEFERRED, revision TEXT NOT NULL, manifest TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(page,revision));
  CREATE TABLE IF NOT EXISTS assets(page TEXT NOT NULL, revision TEXT NOT NULL, path TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(page,revision,path), FOREIGN KEY(page,revision) REFERENCES versions(page,revision));
  CREATE TABLE IF NOT EXISTS __wiki_receipts(actor TEXT NOT NULL, operation TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,operation));
`);

function grants(value = []) {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== "string" || !v.trim())
  )
    fail("Invalid principal grants");
  return [...new Set(value)].sort();
}
function backend(id) {
  const row = registry
    .prepare("SELECT * FROM backends WHERE id=?")
    .get(slug(id));
  if (!row) fail("Backend not found", "NOT_FOUND", 404);
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    owner: String(row.owner),
    readers: JSON.parse(String(row.readers)),
    writers: JSON.parse(String(row.writers)),
    access_revision: Number(row.access_revision),
    created_at: String(row.created_at),
  };
}
const principal = (actor) => actor.principal || actor.id;
const receiptActor = (actor) =>
  stable({
    id: actor.id,
    authority: actor.authority || { mode: "human", subject: null },
  });
function access(record, actor, action = "read") {
  if (record.owner === principal(actor) || actor.manager) return;
  const allowed =
    action === "read"
      ? [...record.readers, ...record.writers]
      : action === "write"
        ? record.writers
        : [];
  if (!allowed.includes("*") && !allowed.includes(principal(actor)))
    fail("Backend not found", "NOT_FOUND", 404);
}
function ownPage(record, actor) {
  if (record && record.owner !== principal(actor) && !actor.manager)
    fail("Only the page owner or a manager can publish", "APP_FORBIDDEN", 403);
}
function openBackend(id, create = false) {
  const filename = path.join(root, "backends", `${slug(id)}.sqlite3`);
  const exists = fs.existsSync(filename);
  const db = database(filename, create);
  try {
    if (create && !exists)
      db.exec(`CREATE TABLE __wiki_schema(revision INTEGER NOT NULL);
    INSERT INTO __wiki_schema SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM __wiki_schema);
    CREATE TABLE __wiki_receipts(actor TEXT NOT NULL, operation TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor,operation));`);
    const revisions = db.prepare("SELECT revision FROM __wiki_schema").all();
    db.prepare(
      "SELECT actor,operation,digest,result FROM __wiki_receipts LIMIT 0",
    ).all();
    if (
      revisions.length !== 1 ||
      !Number.isSafeInteger(revisions[0].revision) ||
      Number(revisions[0].revision) < 0
    )
      fail("Invalid backend schema state", "APP_STORAGE", 503);
    // Only an empty provision interrupted before registry commit is reusable.
    // Never adopt an unregistered database containing application data.
    if (
      create &&
      exists &&
      (revisions[0].revision !== 0 ||
        db.prepare("SELECT 1 FROM __wiki_receipts LIMIT 1").get() ||
        db
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE substr(name,1,7) NOT IN ('__wiki_','sqlite_') LIMIT 1",
          )
          .get())
    )
      fail("Unregistered backend data requires recovery", "APP_STORAGE", 503);
    return db;
  } catch (error) {
    db.close();
    if (error instanceof WikiError) throw error;
    fail(
      "Backend storage is incomplete; restore its durable storage",
      "APP_STORAGE",
      503,
    );
  }
}
const schemaRevision = (db) =>
  db.prepare("SELECT revision FROM __wiki_schema").get().revision;
function describeBackend(record) {
  const db = openBackend(record.id);
  try {
    return {
      ...record,
      database: "sqlite",
      api_url: `/api/backends/${record.id}`,
      schema_revision: schemaRevision(db),
      schema: db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE substr(name,1,7) <> '__wiki_' AND substr(name,1,7) <> 'sqlite_' ORDER BY type,name",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}
function policy(mode) {
  const reads = new Set([
    sql.SQLITE_READ,
    sql.SQLITE_SELECT,
    sql.SQLITE_FUNCTION,
    sql.SQLITE_RECURSIVE,
  ]);
  const data = new Set([
    ...reads,
    sql.SQLITE_INSERT,
    sql.SQLITE_UPDATE,
    sql.SQLITE_DELETE,
  ]);
  const denied = new Set([
    sql.SQLITE_ATTACH,
    sql.SQLITE_DETACH,
    sql.SQLITE_PRAGMA,
    sql.SQLITE_TRANSACTION,
    sql.SQLITE_SAVEPOINT,
  ]);
  return (action, first, second) => {
    if (
      denied.has(action) ||
      [first, second].some(
        (v) => typeof v === "string" && v.toLowerCase().startsWith("__wiki_"),
      )
    )
      return sql.SQLITE_DENY;
    if (
      action === sql.SQLITE_FUNCTION &&
      ["load_extension", "readfile", "writefile", "fts3_tokenizer"].includes(
        String(second).toLowerCase(),
      )
    )
      return sql.SQLITE_DENY;
    if (mode === "read" && !reads.has(action)) return sql.SQLITE_DENY;
    if (mode === "write" && !data.has(action)) return sql.SQLITE_DENY;
    return sql.SQLITE_OK;
  };
}
function statement(db, args, mode) {
  string(args.sql, "sql");
  const params = args.parameters ?? [];
  if (
    !Array.isArray(params) ||
    params.some(
      (v) =>
        v !== null &&
        typeof v !== "string" &&
        (typeof v !== "number" || !Number.isFinite(v)),
    )
  )
    fail("Invalid SQL parameters");
  db.setAuthorizer(policy(mode));
  try {
    const prepared = db.prepare(args.sql);
    if (args.sql.slice(prepared.sourceSQL.length).trim())
      fail(
        "Supply one SQL statement; use migrations for multiple schema statements",
      );
    prepared.setReadBigInts(true);
    const rows = prepared.all(...params);
    return JSON.parse(json({ rows }));
  } finally {
    db.setAuthorizer(null);
  }
}
const authorizations = new Map();
function authorize(request) {
  return new Promise((resolve, reject) => {
    authorizations.set(request, { resolve, reject });
    process.send({ authorize: request });
  });
}
async function mutation(db, request, actor, op, args, perform) {
  string(args.operation_id, "operation_id");
  const digest = hash(stable({ op, args }));
  const previous = db
    .prepare(
      "SELECT digest,result FROM __wiki_receipts WHERE actor=? AND operation=?",
    )
    .get(receiptActor(actor), args.operation_id);
  if (previous) {
    if (previous.digest !== digest)
      fail(
        "operation_id was used with different input",
        "OPERATION_CONFLICT",
        409,
      );
    await authorize(request);
    return JSON.parse(previous.result);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = perform();
    await authorize(request);
    const value = {
      ...result,
      operation_id: args.operation_id,
      actor: actor.id,
      authority: actor.authority || { mode: "human", subject: null },
    };
    db.prepare("INSERT INTO __wiki_receipts VALUES (?,?,?,?)").run(
      receiptActor(actor),
      args.operation_id,
      digest,
      json(value),
    );
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.setAuthorizer(null);
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
function page(id, revision = null) {
  slug(id);
  const record = registry.prepare("SELECT * FROM pages WHERE id=?").get(id);
  if (!record) fail("Page not found", "NOT_FOUND", 404);
  const version = registry
    .prepare("SELECT * FROM versions WHERE page=? AND revision=?")
    .get(id, revision || record.revision);
  if (!version) fail("Page revision not found", "NOT_FOUND", 404);
  return {
    id,
    owner: record.owner,
    ...JSON.parse(String(version.manifest)),
    revision: version.revision,
    author: version.author,
    created_at: version.created_at,
    url: `/apps/${id}/`,
    revision_url: `/apps/${id}/${version.revision}/`,
  };
}
const mime = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};
function assetPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    /[\\\x00-\x20?#%]/.test(value) ||
    value.split("/").some((v) => !v || v === "." || v === "..")
  )
    fail("Invalid asset path");
  return value;
}
function bundle(args) {
  const id = slug(args.id),
    title = string(args.title, "title");
  if (
    !args.files ||
    typeof args.files !== "object" ||
    Array.isArray(args.files)
  )
    fail("files must be an object");
  const files = Object.keys(args.files)
    .sort()
    .map((name) => {
      assetPath(name);
      if (path.posix.basename(name) === "wiki-app.js")
        fail("wiki-app.js is reserved for the backend bridge");
      const file = args.files[name];
      if (
        !file ||
        typeof file.content !== "string" ||
        ![undefined, "utf8", "base64"].includes(file.encoding)
      )
        fail("Invalid asset content");
      const data = Buffer.from(
        file.content,
        file.encoding === "base64" ? "base64" : "utf8",
      );
      if (
        file.encoding === "base64" &&
        data.toString("base64") !== file.content
      )
        fail("Invalid base64 asset");
      return {
        name,
        type:
          mime[path.extname(name).toLowerCase()] || "application/octet-stream",
        data,
        sha256: hash(data),
      };
    });
  const entrypoint = assetPath(args.entrypoint || "index.html");
  if (!files.some((f) => f.name === entrypoint && f.type === "text/html"))
    fail("The entrypoint must be a supplied HTML file");
  const articles = [...new Set(args.articles || [])].map(slug);
  const backendAccess = args.backend_access ?? "read";
  if (!["read", "write"].includes(backendAccess))
    fail("Invalid backend_access");
  const manifest = {
    id,
    title,
    description: args.description || "",
    summary: args.summary || "",
    entrypoint,
    backend_id: args.backend_id || null,
    backend_access: backendAccess,
    articles,
    assets: files.map(({ name, type, sha256, data }) => ({
      path: name,
      type,
      sha256,
      bytes: data.length,
    })),
  };
  for (const field of ["description", "summary"])
    if (typeof manifest[field] !== "string") fail(`Invalid ${field}`);
  return { manifest, files };
}
async function execute({ request, op, args, actor }) {
  if (op === "backendList") {
    return {
      backends: registry
        .prepare("SELECT id FROM backends ORDER BY id")
        .all()
        .flatMap(({ id }) => {
          const record = backend(id);
          try {
            access(record, actor);
            return [
              { ...record, database: "sqlite", api_url: `/api/backends/${id}` },
            ];
          } catch {
            return [];
          }
        }),
    };
  }
  if (op === "backendRegister") {
    const id = slug(args.id),
      title = string(args.title, "title");
    return mutation(registry, request, actor, op, args, () => {
      if (registry.prepare("SELECT 1 FROM backends WHERE id=?").get(id))
        fail("Backend already exists", "REVISION_CONFLICT", 409);
      if (
        args.description !== undefined &&
        typeof args.description !== "string"
      )
        fail("Invalid description");
      const db = openBackend(id, true);
      db.close();
      registry
        .prepare("INSERT INTO backends VALUES (?,?,?,?,?,?,1,?)")
        .run(
          id,
          title,
          args.description || "",
          principal(actor),
          json(grants(args.readers)),
          json(grants(args.writers)),
          new Date().toISOString(),
        );
      return describeBackend(backend(id));
    });
  }
  if (op.startsWith("backend")) {
    const record = backend(args.id);
    access(
      record,
      actor,
      ["backendMigrate", "backendGrant"].includes(op)
        ? "manage"
        : op === "backendExecute"
          ? "write"
          : "read",
    );
    if (op === "backendRead") return describeBackend(record);
    if (op === "backendGrant")
      return mutation(registry, request, actor, op, args, () => {
        if (args.expected_revision !== record.access_revision)
          fail(
            "Backend grants changed; read before updating",
            "REVISION_CONFLICT",
            409,
          );
        registry
          .prepare(
            "UPDATE backends SET readers=?,writers=?,access_revision=access_revision+1 WHERE id=?",
          )
          .run(
            json(grants(args.readers)),
            json(grants(args.writers)),
            record.id,
          );
        return describeBackend(backend(record.id));
      });
    const db = openBackend(record.id);
    try {
      if (op === "backendQuery") return statement(db, args, "read");
      if (!["backendMigrate", "backendExecute"].includes(op))
        fail("Unknown backend operation");
      return await mutation(db, request, actor, op, args, () => {
        if (op === "backendMigrate") {
          if (args.expected_revision !== schemaRevision(db))
            fail(
              "Schema changed; read before migrating",
              "REVISION_CONFLICT",
              409,
            );
          string(args.sql, "sql");
          db.setAuthorizer(policy("schema"));
          try {
            db.exec(args.sql);
          } finally {
            db.setAuthorizer(null);
          }
          db.exec("UPDATE __wiki_schema SET revision=revision+1");
          return { id: record.id, schema_revision: schemaRevision(db) };
        }
        const result = statement(db, args, "write");
        const changes = db.prepare(
          "SELECT changes() AS changes,last_insert_rowid() AS last_insert_rowid",
        );
        changes.setReadBigInts(true);
        return JSON.parse(json({ id: record.id, ...result, ...changes.get() }));
      });
    } catch (error) {
      if (error instanceof WikiError) throw error;
      fail(error.message, "APP_SQL_ERROR");
    } finally {
      db.close();
    }
  }
  if (op === "pageList")
    return {
      pages: registry
        .prepare("SELECT id FROM pages ORDER BY id")
        .all()
        .map(({ id }) => page(id)),
    };
  if (op === "pageRead" || op === "pageView") {
    const record = page(args.id, args.revision);
    if (op === "pageView") return record;
    const files = Object.fromEntries(
      registry
        .prepare(
          "SELECT path,data FROM assets WHERE page=? AND revision=? ORDER BY path",
        )
        .all(record.id, record.revision)
        .map((f) => [
          f.path,
          {
            content: Buffer.from(/** @type {Uint8Array} */ (f.data)).toString(
              "base64",
            ),
            encoding: "base64",
          },
        ]),
    );
    return { ...record, files };
  }
  if (op === "pageHistory") {
    page(args.id);
    return {
      versions: registry
        .prepare(
          "SELECT revision FROM versions WHERE page=? ORDER BY rowid DESC",
        )
        .all(args.id)
        .map(({ revision }) => page(args.id, revision)),
    };
  }
  if (op === "pageAsset") {
    const record = page(args.id, args.revision);
    const file = registry
      .prepare(
        "SELECT type,data FROM assets WHERE page=? AND revision=? AND path=?",
      )
      .get(record.id, record.revision, assetPath(args.path));
    if (!file) fail("Asset not found", "NOT_FOUND", 404);
    return {
      type: file.type,
      content: Buffer.from(/** @type {Uint8Array} */ (file.data)).toString(
        "base64",
      ),
    };
  }
  if (op === "pagePublish") {
    const { manifest: definition, files } = bundle(args);
    const manifest = {
      ...definition,
      authority: actor.authority || { mode: "human", subject: null },
    };
    const previous = registry
      .prepare("SELECT * FROM pages WHERE id=?")
      .get(manifest.id);
    ownPage(previous, actor);
    if (manifest.backend_id)
      access(backend(manifest.backend_id), actor, manifest.backend_access);
    return mutation(registry, request, actor, op, args, () => {
      if (args.expected_revision !== (previous?.revision ?? null))
        fail("Page changed; read before publishing", "REVISION_CONFLICT", 409);
      const created = new Date().toISOString();
      const revision = hash(
        stable({
          manifest,
          parent: previous?.revision ?? null,
          operation: args.operation_id,
          actor: actor.id,
        }),
      );
      registry
        .prepare(
          "INSERT INTO pages VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision",
        )
        .run(manifest.id, principal(actor), revision);
      registry
        .prepare("INSERT INTO versions VALUES (?,?,?,?,?)")
        .run(manifest.id, revision, json(manifest), actor.id, created);
      const insert = registry.prepare("INSERT INTO assets VALUES (?,?,?,?,?)");
      for (const f of files)
        insert.run(manifest.id, revision, f.name, f.type, f.data);
      return page(manifest.id);
    });
  }
  fail("Unknown application operation");
}
let queue = Promise.resolve();
process.on(
  "message",
  /** @param {any} message */ (message) => {
    if (message.authorized !== undefined) {
      const pending = authorizations.get(message.authorized);
      authorizations.delete(message.authorized);
      if (message.error)
        pending?.reject(
          new WikiError(
            message.error.code,
            message.error.message,
            message.error.status,
          ),
        );
      else pending?.resolve();
      return;
    }
    queue = queue
      .then(async () => {
        try {
          process.send({
            request: message.request,
            result: await execute(message),
          });
        } catch (error) {
          process.send({
            request: message.request,
            error: {
              code: error.code || "APP_FAILED",
              message: error.message,
              status: error.status || 400,
            },
          });
        }
      })
      .catch(() => {});
  },
);
process.on("disconnect", () => process.exit(0));
