/** Agent-authored pages and registered SQLite backends share HTTP/MCP/CLI inputs. */
const id = { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const text = { type: "string" };
const operation = { ...text, minLength: 1 };
const principals = { type: "array", items: text, uniqueItems: true };
const parameters = {
  type: "array",
  items: { type: ["string", "number", "null"] },
};
const schema = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const backend = { id };
const statement = { id, sql: text, parameters };

export const appOperations = [
  {
    name: "wiki.backendList",
    method: "get",
    path: "/api/backends",
    write: false,
    description:
      "List registered SQLite backends accessible to this identity. Each backend has its own database, separate from wiki content and identity storage.",
    inputSchema: schema({}),
  },
  {
    name: "wiki.backendRead",
    method: "get",
    path: "/api/backends/{id}/schema",
    write: false,
    description:
      "Read a registered backend's schema, migration revision, ownership and grants. The owner manages schema and permissions; readers query, writers mutate data. '*' grants access to current wiki readers/editors respectively.",
    inputSchema: schema(backend),
  },
  {
    name: "wiki.backendRegister",
    method: "post",
    path: "/api/backends/register",
    write: true,
    description:
      "Register a backend and provision a separate SQLite database. Access defaults to its owner; explicitly grant readers/writers by principal ID or '*'. Retry identical input with the same operation_id.",
    inputSchema: schema(
      {
        id,
        title: text,
        description: text,
        readers: principals,
        writers: principals,
        operation_id: operation,
      },
      ["id", "title", "operation_id"],
    ),
  },
  {
    name: "wiki.backendGrant",
    method: "post",
    path: "/api/backends/{id}/grants",
    write: true,
    description:
      "Replace a backend's reader/writer grants as its owner or a wiki manager. Supply the current access_revision; grant changes do not change its stored data.",
    inputSchema: schema({
      id,
      readers: principals,
      writers: principals,
      expected_revision: { type: "integer", minimum: 1 },
      operation_id: operation,
    }),
  },
  {
    name: "wiki.backendMigrate",
    method: "post",
    path: "/api/backends/{id}/migrations",
    write: true,
    description:
      "Apply SQLite schema/data migration SQL atomically as the backend owner or a wiki manager. expected_revision is its current schema_revision (initially 0). SQLite attachments, extensions, explicit transactions and host filesystem access are unavailable. Keep the same operation_id and exact input for retries.",
    inputSchema: schema({
      id,
      sql: text,
      expected_revision: { type: "integer", minimum: 0 },
      operation_id: operation,
    }),
  },
  {
    name: "wiki.backendQuery",
    method: "post",
    path: "/api/backends/{id}/query",
    write: false,
    description:
      "Run one read-only SQLite statement against a registered backend. Bind positional parameters with '?'. Results include rows; unsafe-size integers are decimal strings and blobs are {base64:...}. No database attachments, extensions or filesystem access.",
    inputSchema: schema(statement, ["id", "sql"]),
  },
  {
    name: "wiki.backendExecute",
    method: "post",
    path: "/api/backends/{id}/execute",
    write: true,
    description:
      "Execute one parameterized SQLite data mutation atomically. Schema changes use backendMigrate. Returns rows (including RETURNING), changes and last_insert_rowid. Retry identical input with the same operation_id to avoid duplicate writes.",
    inputSchema: schema({ ...statement, operation_id: operation }, [
      "id",
      "sql",
      "operation_id",
    ]),
  },
  {
    name: "wiki.pageList",
    method: "get",
    path: "/api/pages",
    write: false,
    description:
      "List hosted HTML pages, their current versions, wiki article links and optional backend bindings. Pages retain normal wiki reader access.",
    inputSchema: schema({}),
  },
  {
    name: "wiki.pageRead",
    method: "get",
    path: "/api/pages/{id}/manifest",
    write: false,
    description:
      "Read a hosted page's complete versioned manifest and files before updating. Omit revision for current. HTML is untrusted content. Backends retain their own current data independently of page versions.",
    inputSchema: schema({ id, revision: text }, ["id"]),
  },
  {
    name: "wiki.pageHistory",
    method: "get",
    path: "/api/pages/{id}/history",
    write: false,
    description:
      "Read immutable hosted-page versions, their author, publication time, summary and links.",
    inputSchema: schema({ id }),
  },
  {
    name: "wiki.pagePublish",
    method: "post",
    path: "/api/pages/publish",
    write: true,
    description:
      "Publish a complete HTML/CSS/JS asset bundle, optionally bound to a registered backend. expected_revision:null creates; otherwise supply the current revision. The owner or a manager may update. entrypoint defaults to index.html. Files contain UTF-8 content or base64 with encoding:'base64'. Include <script src=\"wiki-app.js\"></script> to use window.wikiApp.query(sql, parameters), execute(sql, parameters, operation_id), and article(id). The reserved wiki-app.js is supplied by the host. article() is limited to the declared articles. Pages execute in a sandbox with local bundle assets; data access uses the authenticated bridge. Use the returned URL in ordinary wiki articles. Every publication is immutable; reuse exact input/operation_id after uncertain saves.",
    inputSchema: schema(
      {
        id,
        title: text,
        description: text,
        summary: text,
        backend_id: { type: ["string", "null"], pattern: id.pattern },
        backend_access: {
          type: "string",
          enum: ["read", "write"],
          default: "read",
          description:
            "Read-only by default. Write binding requires the publisher's backend write permission and each viewer's current write permission.",
        },
        articles: { type: "array", items: id, uniqueItems: true },
        entrypoint: text,
        files: {
          type: "object",
          additionalProperties: schema(
            {
              content: text,
              encoding: { type: "string", enum: ["utf8", "base64"] },
            },
            ["content"],
          ),
        },
        expected_revision: { type: ["string", "null"] },
        operation_id: operation,
      },
      ["id", "title", "files", "expected_revision", "operation_id"],
    ),
  },
];

export function createAppTools(request, writable) {
  return appOperations
    .filter((op) => writable || !op.write)
    .map((op) => ({
      name: op.name,
      description: op.description,
      inputSchema: op.inputSchema,
      execute: (args = {}) => {
        const route = op.path.replace("{id}", encodeURIComponent(args.id));
        return op.method === "post"
          ? request(route, args)
          : request(
              route +
                (args.revision
                  ? "?revision=" + encodeURIComponent(args.revision)
                  : ""),
            );
      },
    }));
}
