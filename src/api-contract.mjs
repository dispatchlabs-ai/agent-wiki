import { createWikiTools } from "../public/wiki-tools.js";
import { toolAction } from "./authorization.mjs";
import packageInfo from "../package.json" with { type: "json" };

const routes = {
  "wiki.search": ["get", "/api/articles/search", "search"],
  "wiki.read": ["get", "/api/articles/{id}/{revision}.json", "read"],
  "wiki.history": ["get", "/api/articles/{id}/history.json", "history"],
  "wiki.save": ["post", "/api/articles/edits", "create, edit, save"],
  "wiki.preview": ["post", "/api/articles/preview", "preview"],
  "wiki.traceSearch": ["get", "/api/traces/search", "trace-search"],
  "wiki.traces": ["get", "/api/traces/catalog.json", "traces"],
  "wiki.trace": ["get", "/api/traces/{id}.json", "trace"],
  "wiki.traceLines": ["get", "/api/traces/{id}/lines.json", "trace-lines"],
  "wiki.traceSessions": ["get", "/api/traces/sessions.json", "trace-sessions"],
  "wiki.traceProvenance": [
    "get",
    "/api/traces/provenance.json",
    "trace-provenance",
  ],
  "wiki.file": ["get", "/api/files/{asset}.json", "file"],
};
const tools = new Map();
for (const externalEvidence of [false, true])
  for (const tool of createWikiTools(() => Promise.resolve(), true, {
    externalEvidence,
  })) {
    const previous = tools.get(tool.name);
    tools.set(tool.name, {
      ...tool,
      inputSchema: previous
        ? {
            ...tool.inputSchema,
            properties: {
              ...previous.inputSchema.properties,
              ...tool.inputSchema.properties,
            },
          }
        : tool.inputSchema,
    });
  }
// One inventory drives the published contract and drift checks. Browser and both
// MCP transports call these same HTTP operations; the CLI is a remote client too.
export const operations = [...tools.values()].map((tool) => ({
  id: tool.name,
  method: routes[tool.name][0],
  path: routes[tool.name][1],
  permission: toolAction(tool.name),
  input: tool.inputSchema,
  description: tool.description,
  interfaces: {
    http: "supported",
    web: "supported",
    mcp: "supported",
    webmcp: "supported",
    cli: routes[tool.name][2],
  },
}));

const object = { type: "object", additionalProperties: true };
const string = { type: "string" };
const error = {
  type: "object",
  required: ["error", "code"],
  properties: { error: string, code: string },
  additionalProperties: true,
};
const page = {
  type: "object",
  required: ["id", "title", "description", "body", "revision_id"],
  properties: {
    id: string,
    title: string,
    description: string,
    body: string,
    revision_id: string,
    backlinks: { type: "array", items: object },
    evidence: { type: "array", items: object },
  },
  additionalProperties: true,
};
const receipt = {
  type: "object",
  required: ["operation_id", "state", "articles", "commit"],
  properties: {
    operation_id: string,
    state: { enum: ["saved", "already-saved"] },
    commit: string,
    articles: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "number", "revision_id", "url"],
        properties: {
          id: string,
          number: { type: "integer" },
          revision_id: string,
          url: string,
        },
      },
    },
    remote: { enum: ["not-requested", "pushed", "push-failed"] },
    publication: { enum: ["live", "refresh-failed"] },
  },
  additionalProperties: true,
};
const responseSchemas = {
  "wiki.read": {
    anyOf: [
      page,
      {
        type: "object",
        required: ["id", "revision_id", "number", "commit", "url", "partial"],
        properties: {
          ...page.properties,
          number: { type: "integer", minimum: 1 },
          commit: string,
          url: string,
          partial: { const: true },
          section: object,
          sections: { type: "array", items: object },
        },
        additionalProperties: true,
      },
    ],
  },
  "wiki.save": receipt,
  "wiki.preview": {
    type: "object",
    required: ["html"],
    properties: { html: string },
  },
  "wiki.history": {
    type: "object",
    required: ["id", "revisions"],
    properties: { id: string, revisions: { type: "array", items: object } },
  },
  "wiki.search": {
    type: "object",
    required: ["total", "articles"],
    properties: {
      total: { type: "integer" },
      articles: { type: "array", items: object },
      nextOffset: { type: ["integer", "null"] },
    },
  },
  "wiki.traceSearch": {
    type: "object",
    required: ["indexed", "results"],
    properties: {
      indexed: { type: "boolean" },
      results: { type: "array", items: object },
      nextOffset: { type: ["integer", "null"] },
    },
  },
};
/** @returns {Record<string, {schema: any}>} */
function content(schema) {
  return { "application/json": { schema } };
}
function parameters(input, route) {
  const props = { ...input.properties };
  if (route.includes("{revision}"))
    props.revision = {
      type: "string",
      pattern: "^(current|[1-9][0-9]*|[a-f0-9]{40})$",
      description: "current, revision number, or Git commit",
    };
  if (route === "/api/traces/{id}.json") {
    props.id = {
      type: "string",
      pattern: "^(chat-[a-f0-9]{24}|[a-f0-9]{64})$",
    };
    props.view = {
      type: "string",
      enum: ["conversation"],
      description:
        "Required for imported dialogue projection; omit for the original rendered record page",
    };
  }
  return Object.entries(props).map(([name, schema]) => ({
    name,
    in: route.includes(`{${name}}`) ? "path" : "query",
    required: route.includes(`{${name}}`) || !!input.required?.includes(name),
    schema,
    ...(schema.type === "array" ? { style: "form", explode: false } : {}),
  }));
}
function fields(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}
const definition = fields({
  instructions: { type: "string", maxLength: 20000 },
  tools: {
    type: "array",
    maxItems: 100,
    items: { type: "string", maxLength: 200 },
  },
});
const requestSchemas = {
  "accounts.login": fields({ email: string, password: string }),
  "accounts.setup": fields({ token: string, password: string }),
  "accounts.password": fields({ currentPassword: string, password: string }),
  "accounts.logout": fields({}, []),
  "accounts.invite": fields({ email: string, name: string }),
  "access.grant": fields({
    principal: string,
    role: { enum: [null, "reader", "editor", "manager"] },
  }),
  "agents.manage": {
    oneOf: [
      fields({ action: { const: "create" }, name: string, definition }),
      fields({ action: { const: "configure" }, agent: string, definition }),
      fields({
        action: { const: "permission" },
        agent: string,
        principal: string,
        permission: { enum: ["invoke", "configure", "manage-access"] },
        enabled: { type: "boolean" },
      }),
      fields({
        action: { const: "role" },
        agent: string,
        role: { enum: [null, "reader", "editor"] },
      }),
      fields({ action: { const: "revoke" }, connection: string }),
    ],
  },
  "oauth.register": fields(
    {
      client_name: { type: "string", maxLength: 200 },
      redirect_uris: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { type: "string", format: "uri" },
      },
      token_endpoint_auth_method: { const: "none" },
      grant_types: {
        type: "array",
        items: { enum: ["authorization_code", "refresh_token"] },
      },
      response_types: { type: "array", items: { const: "code" } },
    },
    ["redirect_uris"],
  ),
  "oauth.revoke": fields({ client_id: string, token: string }),
  "oauth.token": {
    oneOf: [
      fields(
        {
          grant_type: { const: "authorization_code" },
          client_id: string,
          code: string,
          code_verifier: string,
          redirect_uri: string,
          resource: string,
        },
        ["grant_type", "client_id", "code", "code_verifier", "redirect_uri"],
      ),
      fields(
        {
          grant_type: { const: "refresh_token" },
          client_id: string,
          refresh_token: string,
          resource: string,
        },
        ["grant_type", "client_id", "refresh_token"],
      ),
      fields(
        {
          grant_type: { const: "client_credentials" },
          client_id: string,
          client_assertion_type: {
            const: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
          },
          client_assertion: string,
          resource: string,
          scope: string,
        },
        ["grant_type", "client_assertion_type", "client_assertion", "resource"],
      ),
    ],
  },
};
function entry(id, description, permission, schema = object) {
  return {
    operationId: id,
    description,
    "x-wiki-permission": permission,
    security:
      permission === "public"
        ? []
        : permission === "human" || permission === "manager"
          ? [{ browserSession: [] }]
          : [{ browserSession: [] }, { bearerAuth: [] }],
    responses: {
      200: {
        description:
          "Success. Exact original evidence payloads depend on the configured archive; see external-evidence.md and traces.md.",
        content: content(schema),
      },
      ...Object.fromEntries(
        [400, 401, 403, 404, 405, 409, 413, 429, 503].map((code) => [
          code,
          {
            description:
              {
                401: "Authentication required or expired",
                404: "Unavailable or unauthorized; resource existence is not disclosed",
                409: "Revision, operation identity, or lock conflict",
                503: "Temporarily unavailable; retain exact write input for reconciliation",
              }[code] || "Request rejected",
            content: content(error),
          },
        ]),
      ),
    },
  };
}
export function openAPI() {
  const paths = {};
  for (const operation of operations) {
    const spec = entry(
      operation.id,
      operation.description,
      operation.permission,
      responseSchemas[operation.id] ||
        (operation.id === "wiki.traces"
          ? { oneOf: [object, { type: "array", items: object }] }
          : object),
    );
    spec["x-wiki-interfaces"] = operation.interfaces;
    if (operation.method === "post") {
      spec.requestBody = { required: true, content: content(operation.input) };
      spec.parameters = [
        {
          name: "Origin",
          in: "header",
          required: false,
          schema: string,
          description:
            "Required with browser session; must equal configured origin when present",
        },
        {
          name: "X-Wiki-CSRF",
          in: "header",
          required: false,
          schema: string,
          description: "Required with browser session",
        },
      ];
      if (operation.id === "wiki.save")
        spec.parameters.push({
          name: "X-Wiki-Write",
          in: "header",
          required: true,
          schema: { type: "string", const: "1" },
          description: "Explicit write opt-in; WIKI_WRITE must also be enabled",
        });
    } else spec.parameters = parameters(operation.input, operation.path);
    paths[operation.path] ??= {};
    paths[operation.path][operation.method] = spec;
  }
  const extras = [
    [
      "get",
      "/healthz",
      "health.live",
      "public",
      "Process liveness only; no content or source metadata.",
    ],
    [
      "get",
      "/api/openapi.json",
      "contract.read",
      "public",
      "This versioned HTTP contract; static docs/openapi.json is identical.",
    ],
    [
      "get",
      "/api/articles/catalog.json",
      "articles.catalog",
      "read",
      "Published article metadata.",
    ],
    [
      "get",
      "/api/articles/authoring.json",
      "articles.authoring",
      "read",
      "Current tool availability and editing prerequisites for this caller.",
    ],
    [
      "get",
      "/api/articles/health.json",
      "articles.health",
      "read",
      "Article health. Evidence components are included only with trace authority and rechecked before response.",
    ],
    [
      "get",
      "/api/me",
      "identity.read",
      "human",
      "Browser/local-login identity and CSRF. Never a bearer endpoint.",
    ],
    [
      "get",
      "/api/agent/run",
      "run.read",
      "bearer",
      "Authenticated agent actor, initiator, subject, definition and scope.",
    ],
    [
      "delete",
      "/api/agent/run",
      "run.close",
      "bearer",
      "Revoke the bearer caller's run.",
    ],
    [
      "get",
      "/api/agents",
      "agents.list",
      "human",
      "Owned or shared agent definitions; permissions checked per agent.",
    ],
    [
      "post",
      "/api/agents",
      "agents.manage",
      "human",
      "Explicit human administration: create, configure, permission, role or revoke. See remote-agents.md; session CSRF required.",
    ],
    [
      "get",
      "/api/access",
      "access.list",
      "manager",
      "Human manager's principal directory.",
    ],
    [
      "post",
      "/api/access",
      "access.grant",
      "manager",
      "Assign/revoke reader, editor or manager; last human manager retained. Session CSRF required.",
    ],
    [
      "post",
      "/api/access/invitations",
      "accounts.invite",
      "manager",
      "Create a local-account setup link; deliver privately. Session CSRF required. Returns 201.",
    ],
    [
      "get",
      "/.well-known/oauth-protected-resource/mcp",
      "oauth.resource",
      "public",
      "RFC 9728 protected resource metadata.",
    ],
    [
      "get",
      "/.well-known/oauth-protected-resource",
      "oauth.resourceAlias",
      "public",
      "Protected resource discovery alias.",
    ],
    [
      "get",
      "/.well-known/oauth-authorization-server",
      "oauth.metadata",
      "public",
      "Authorization server metadata for this wiki.",
    ],
    [
      "post",
      "/oauth/register",
      "oauth.register",
      "public",
      "Dynamic registration with exact HTTPS/loopback redirects. JSON; returns 201.",
    ],
    [
      "post",
      "/oauth/token",
      "oauth.token",
      "public",
      "Form-encoded PKCE authorization_code, rotating refresh_token, or enrolled private_key_jwt client_credentials. Resource is origin + /mcp. Never retry an uncertain refresh token exchange.",
    ],
    [
      "post",
      "/oauth/revoke",
      "oauth.revoke",
      "public",
      "Form-encoded client_id and token revoke the corresponding client connection.",
    ],
    [
      "post",
      "/auth/local/login",
      "accounts.login",
      "public",
      "Local email/password login. Obtain cookie-bound wiki_form from GET / first; send same Origin and X-Wiki-CSRF. Returns HttpOnly wiki_session cookie.",
    ],
    [
      "post",
      "/auth/local/setup",
      "accounts.setup",
      "public",
      "Accept one-use account invitation with token and password; form cookie and CSRF required.",
    ],
    [
      "post",
      "/auth/local/password",
      "accounts.password",
      "human",
      "Change local password with currentPassword and password; session CSRF required.",
    ],
    [
      "post",
      "/auth/logout",
      "accounts.logout",
      "human",
      "Invalidate caller's browser session; session CSRF required.",
    ],
    [
      "get",
      "/media/{asset}",
      "evidence.download",
      "trace",
      "Original evidence bytes; supports Range and optional download filename. Protected no-store response.",
    ],
    [
      "get",
      "/article-media/{asset}",
      "article-media.download",
      "read",
      "Deliberately published article image or PDF bytes; supports Range and optional download filename. Independent from original evidence.",
    ],
    [
      "get",
      "/api/evidence/v1/{route}",
      "evidence.proxy",
      "trace",
      "Protected provider passthrough; route may contain slashes. Provider owns version-1 schemas (external-evidence.md); no stable engine schema is asserted for arbitrary provider extensions.",
    ],
  ];
  for (const [method, route, id, permission, description] of extras) {
    paths[route] ??= {};
    const spec = (paths[route][method] = entry(id, description, permission));
    spec.parameters = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: string,
    }));
    if (id === "articles.health") {
      const health = {
        type: "object",
        required: ["state", "commit", "articles", "components"],
        properties: {
          state: { enum: ["ready", "degraded"] },
          commit: string,
          articles: { type: "integer" },
          components: object,
          error: { type: ["string", "null"] },
        },
        additionalProperties: true,
      };
      spec.responses["200"].content = content(health);
      spec.responses["503"].content = content({ anyOf: [health, error] });
    }
    if (id === "agents.manage")
      spec.responses["201"] = {
        description: "Created agent definition; no implicit content grant",
        content: content(object),
      };
    if (id === "articles.catalog")
      spec.responses["200"].content = content({ type: "array", items: object });
    if (["evidence.download", "article-media.download"].includes(id)) {
      spec.parameters.push(
        {
          name: "Range",
          in: "header",
          required: false,
          schema: string,
          description: "Byte range, e.g. bytes=0-1023",
        },
        {
          name: "download",
          in: "query",
          required: false,
          schema: string,
          description: "Download filename; at most 240 characters used",
        },
      );
      const media = {
        description:
          id === "evidence.download"
            ? "Original evidence bytes; never public cacheable"
            : "Published article media bytes; never public cacheable",
        content: Object.fromEntries(
          [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "application/pdf",
            "application/octet-stream",
          ].map((type) => [
            type,
            { schema: { type: "string", format: "binary" } },
          ]),
        ),
      };
      spec.responses["200"] = media;
      spec.responses["206"] = {
        ...media,
        description: "Requested partial byte range",
        headers: {
          "Content-Range": { schema: string },
          "Accept-Ranges": { schema: string },
        },
      };
      spec.responses["416"] = { description: "Unsatisfiable byte range" };
    }
    if (id === "evidence.proxy")
      spec.responses["200"].content = {
        "application/json": { schema: {} },
        "application/octet-stream": {
          schema: { type: "string", format: "binary" },
        },
      };
    if (permission === "bearer") spec.security = [{ bearerAuth: [] }];
    if (method === "post")
      spec.requestBody = {
        required: true,
        content: {
          [route.startsWith("/oauth/") && route !== "/oauth/register"
            ? "application/x-www-form-urlencoded"
            : "application/json"]: { schema: requestSchemas[id] || object },
        },
      };
    if (["oauth.register", "accounts.invite"].includes(id)) {
      spec.responses["201"] = spec.responses["200"];
      delete spec.responses["200"];
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Wiki HTTP API",
      version: packageInfo.version,
      description:
        "Single-space Git-backed wiki. Reader permits published articles, history and citations; editor/manager permits original evidence independently of WIKI_WRITE. Bearer callers additionally need matching read/write/trace run scope. All clients use the same server and writer. Human-only account/agent administration is intentionally excluded from machine credentials. HTML navigation and MCP JSON-RPC have their own documented contracts. See docs/api.md and docs/interfaces.md.",
    },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: {
        browserSession: {
          type: "apiKey",
          in: "cookie",
          name: "wiki_session",
          description:
            "Human session; mutations require Origin and X-Wiki-CSRF.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Wiki-issued agent token. Obtain through browser OAuth or enrolled machine key; matching current grants and scopes required.",
        },
      },
      schemas: { Error: error, Article: page, SaveReceipt: receipt },
    },
  };
}
