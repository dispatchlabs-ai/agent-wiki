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
// Tool inputs also drive the live HTTP contract. Browser and both
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
    actor: {
      ...string,
      description: "Recorded authenticated principal ID, when available.",
    },
    authority: {
      ...object,
      description:
        "Original agent authority recorded for this caller's save; absent for human and operator writes.",
    },
    initiator: {
      ...string,
      description:
        "Recorded human initiator of an agent save, when available. Older receipts may omit this field.",
    },
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
  "accounts.login": fields(
    { email: string, password: string, returnTo: string },
    ["email", "password"],
  ),
  "accounts.setup": fields({ token: string, password: string }),
  "accounts.password": fields({ currentPassword: string, password: string }),
  "accounts.logout": fields({}, []),
  "accounts.invite": fields({ email: string, name: string }),
  "accounts.verifyCode": fields(
    { code: string, recovery: { type: "boolean", default: false } },
    ["code"],
  ),
  "accounts.passkeyOptions": fields({}, []),
  "accounts.verifyPasskey": fields({ flow: string, response: object }),
  "accounts.securityChange": {
    oneOf: [
      ...["totp-start", "passkey-start", "recovery", "disable"].map((action) =>
        fields({ action: { const: action } }),
      ),
      fields({ action: { const: "totp-finish" }, flow: string, code: string }),
      fields(
        {
          action: { const: "passkey-finish" },
          flow: string,
          response: object,
          name: { type: "string", maxLength: 100 },
        },
        ["action", "flow", "response"],
      ),
      fields({
        action: { const: "rename" },
        factor: string,
        name: { type: "string", minLength: 1, maxLength: 100 },
      }),
      fields({ action: { const: "remove" }, factor: string }),
    ],
  },
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
/** @param {string} id @param {string} description @param {string} permission @param {Record<string, any>} [schema] @returns {Record<string, any>} */
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
          "Success. Original evidence payload extensions belong to the configured archive.",
        content: content(schema),
      },
      ...Object.fromEntries(
        [400, 401, 403, 404, 405, 409, 413, 429, 500, 503].map((code) => [
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
    if (operation.id === "wiki.read")
      spec.description +=
        " HTTP also accepts a 40-hex Git commit in revision; tool inputs accept numbered revisions. Full current reads include backlinks, historical reads preserve their original metadata.";
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
      "The versioned HTTP contract generated by this server.",
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
      "Explicit human administration: create, configure, permission, role or revoke; session CSRF required.",
    ],
    [
      "get",
      "/api/access",
      "access.list",
      "manager",
      "Human manager's principal and agent directory. Agent entries include creator, owner, wiki role, shared people, enabled tools and the caller's manage-access permission; this visibility does not grant use or configuration rights.",
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
      "Local email/password login. Obtain cookie-bound wiki_form from GET /auth/sign-in?mode=local first; send same Origin and X-Wiki-CSRF. Returns wiki_session when unenrolled, otherwise wiki_mfa plus mfaRequired, csrf and redirect for the second-factor challenge.",
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
      "Change local password with currentPassword and password; session CSRF and recent second-factor proof when enrolled are required.",
    ],
    [
      "get",
      "/api/account/security",
      "accounts.security",
      "human",
      "List the caller's second-factor methods and remaining recovery-code count. Never returns stored TOTP secrets or passkey private keys.",
    ],
    [
      "post",
      "/api/account/security",
      "accounts.securityChange",
      "human",
      "Manage caller's optional MFA with action totp-start, totp-finish, passkey-start, passkey-finish, rename, remove, recovery, or disable. Exact Origin, session CSRF and sign-in within five minutes required. Enrollment returns owner-bound flow/options; factor proof finishes enrollment. passkey-finish accepts an optional name (otherwise an available Passkey N label). rename requires factor and a nonempty name of at most 100 characters and changes only an owned passkey label, preserving sessions and credentials. Other changes rotate the cookie and CSRF; first enrollment and recovery renewal return recoveryCodes once. Completed changes include current status.",
    ],
    [
      "post",
      "/auth/mfa/code",
      "accounts.verifyCode",
      "public",
      "Complete a pending wiki_mfa cookie challenge using code and optional recovery:true. Requires exact Origin and its cookie-bound X-Wiki-CSRF. Returns wiki_session and original destination; pending challenges alone authorize no content.",
    ],
    [
      "post",
      "/auth/mfa/passkey/options",
      "accounts.passkeyOptions",
      "public",
      "Get user-verification-required WebAuthn authentication options for an enrolled identity's pending wiki_mfa cookie. Exact Origin and pending CSRF required. Returns flow and options.",
    ],
    [
      "post",
      "/auth/mfa/passkey/verify",
      "accounts.verifyPasskey",
      "public",
      "Finish the owner-bound WebAuthn flow with response. Exact Origin, wiki_mfa cookie and pending CSRF required. Returns wiki_session only after verified origin, RP, challenge, ownership and user verification.",
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
      "Protected GET-only provider passthrough; route may contain slashes and query parameters are forwarded. Provider owns version-1 schemas; no stable engine schema is asserted for arbitrary provider extensions.",
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
  completeContract(paths);
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Wiki HTTP API",
      version: packageInfo.version,
      description:
        "Single-space Git-backed wiki. Reader permits published articles, history and citations; editor/manager permits original evidence independently of WIKI_WRITE. Bearer callers additionally need matching read/write/trace run scope. All clients use the same server and writer. Human-only account/agent administration is intentionally excluded from machine credentials. Browser navigation, OAuth callbacks and MCP transport are included; JSON-RPC tool inputs are shared with the HTTP operations. The CLI /callback operation uses its own temporary loopback server, not the wiki origin. No inbound webhooks are implemented.",
    },
    servers: [{ url: "/" }],
    tags: [
      "Articles",
      "Evidence",
      "Accounts",
      "Access",
      "Agents",
      "OAuth",
      "Service",
      "Browser",
      "MCP",
      "CLI",
    ].map((name) => ({ name })),
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
        localForm: {
          type: "apiKey",
          in: "cookie",
          name: "wiki_form",
          description:
            "Cookie-bound anti-CSRF form token from the sign-in/setup page; grants no content access.",
        },
        pendingMfa: {
          type: "apiKey",
          in: "cookie",
          name: "wiki_mfa",
          description:
            "Short-lived pending second-factor challenge after primary sign-in; grants no content access.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Wiki-issued agent token. Obtain through browser OAuth or enrolled machine key; matching current grants and scopes required.",
        },
      },
      schemas: {
        Error: error,
        Article: page,
        SaveReceipt: receipt,
        ...schemas,
      },
    },
  };
}

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
/** @param {Record<string, any>} [items] */
const array = (items = object) => ({ type: "array", items });
const integer = { type: "integer", minimum: 0 };
const boolean = { type: "boolean" };
const nullableString = { type: ["string", "null"] };
const nextOffset = { type: ["integer", "null"], minimum: 0 };
// Response objects allow archive/frontmatter extensions, unlike closed tool inputs.
const record = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
/** @param {string} key @param {Record<string, any>} [item] */
const schemaPage = (key, item = object) =>
  record({ [key]: array(item), total: integer, nextOffset });
const schemas = {
  ArticleMetadata: record({
    id: string,
    title: string,
    description: string,
    topic: string,
    number: integer,
    revision_id: string,
    commit: string,
    url: string,
  }),
  Revision: record({
    number: integer,
    commit: string,
    created_at: string,
    summary: string,
    filename: string,
    url: string,
    attribution: record({
      kind: { enum: ["human", "agent", "operator", "unknown"] },
      actor: nullableString,
      authority: {
        anyOf: [
          { type: "null" },
          record({
            mode: { enum: ["independent", "delegated"] },
            subject: nullableString,
            initiator: nullableString,
          }),
        ],
      },
    }),
  }),
  TraceMetadata: record({
    id: string,
    format: { enum: ["codex", "pi", "claude"] },
    title: string,
    bytes: integer,
    records: integer,
    session_id: nullableString,
    imported_at: string,
  }),
  EvidenceCatalog: {
    ...record(
      {
        items: array(),
        results: array(),
        total: integer,
        nextOffset,
        indexed: boolean,
      },
      [],
    ),
    anyOf: [{ required: ["items"] }, { required: ["results"] }],
    description:
      "External catalog/search passthrough: catalogs use items or results; searches use results. Counts, pagination and indexing metadata are provider-dependent.",
  },
  TracePage: record({
    id: string,
    format: string,
    page: integer,
    pages: integer,
    total_records: integer,
    records: array(),
  }),
  Conversation: record({ id: string, messages: array(), kind: string }, [
    "id",
    "kind",
  ]),
  TraceLines: record({
    id: string,
    format: string,
    start: integer,
    end: integer,
    total_lines: integer,
    nextStart: nextOffset,
    lines: array(
      record({ line: integer, raw: string, value: {}, url: nullableString }),
    ),
  }),
  Provenance: record({
    logical_key: string,
    provenance: array(
      record({
        id: string,
        line: integer,
        page: integer,
        url: string,
        imported_at: string,
      }),
    ),
    total: integer,
    snapshot_count: integer,
    nextOffset,
    next: nullableString,
  }),
  Attachment: record({
    attachment: record(
      {
        name: string,
        status: string,
        kind: string,
        url: nullableString,
        download_url: string,
        preview: string,
        preview_truncated: boolean,
      },
      ["status"],
    ),
  }),
  Identity: record({
    id: string,
    name: string,
    csrf: string,
    role: nullableString,
    localAccount: boolean,
  }),
  Agent: record(
    {
      id: string,
      name: string,
      owner: string,
      definition: string,
      active: integer,
    },
    ["id", "name", "owner", "definition"],
  ),
  Run: record({
    agent: string,
    run: string,
    initiator: string,
    subject: nullableString,
    mode: { enum: ["independent", "delegated"] },
    definition: string,
    scope: array(
      record({
        space: string,
        actions: array({ enum: ["read", "trace", "write"] }),
      }),
    ),
  }),
  Access: record({
    principals: array(),
    agents: array(
      record({
        id: string,
        name: string,
        role: nullableString,
        creator: { type: ["object", "null"] },
        owner: { type: ["object", "null"] },
        tools: { type: ["array", "null"], items: string },
        grants: array(),
        manage: boolean,
      }),
    ),
  }),
  Security: record({
    enabled: boolean,
    recoveryCodes: integer,
    factors: array(
      record({
        id: string,
        kind: { enum: ["totp", "passkey"] },
        name: string,
        created: integer,
      }),
    ),
  }),
  SecurityChange: {
    anyOf: [
      record({ flow: string, secret: string, uri: string, qr: string }),
      record({ flow: string, options: object }),
      record(
        {
          saved: { const: true },
          csrf: string,
          status: ref("Security"),
          recoveryCodes: array(string),
        },
        ["saved", "status"],
      ),
    ],
  },
  SignIn: {
    oneOf: [
      record({ signedIn: { const: true } }),
      record({ mfaRequired: { const: true }, csrf: string, redirect: string }),
    ],
  },
  Token: record(
    {
      access_token: string,
      token_type: { const: "Bearer" },
      expires_in: integer,
      scope: string,
      refresh_token: string,
      wiki_run: string,
    },
    ["access_token", "token_type", "expires_in"],
  ),
  OAuthClient: record({
    client_id: string,
    client_name: string,
    redirect_uris: array(string),
    token_endpoint_auth_method: { const: "none" },
    grant_types: array(string),
    response_types: array(string),
  }),
  OAuthResource: record({
    resource: string,
    authorization_servers: array(string),
    scopes_supported: array(string),
    bearer_methods_supported: array(string),
  }),
  OAuthMetadata: record({
    issuer: string,
    authorization_endpoint: string,
    token_endpoint: string,
    registration_endpoint: string,
    revocation_endpoint: string,
    response_types_supported: array(string),
    grant_types_supported: array(string),
    code_challenge_methods_supported: array(string),
    token_endpoint_auth_methods_supported: array(string),
    scopes_supported: array(string),
  }),
  Authoring: record({
    workflow: string,
    storage: string,
    tools: array(string),
    mcp: record({ url: string, transport: string }),
    write: boolean,
    externalEvidence: boolean,
    conversations: boolean,
    evidenceAccess: boolean,
    access: string,
  }),
  JsonRpc: {
    type: "object",
    required: ["jsonrpc"],
    properties: {
      jsonrpc: { const: "2.0" },
      id: { type: ["string", "integer", "null"] },
      method: string,
      params: object,
      result: {},
      error: record({ code: { type: "integer" }, message: string, data: {} }, [
        "code",
        "message",
      ]),
    },
    additionalProperties: false,
  },
  JsonRpcError: {
    type: "object",
    required: ["jsonrpc", "id", "error"],
    properties: {
      jsonrpc: { const: "2.0" },
      id: { type: ["string", "integer", "null"] },
      error: record({ code: { type: "integer" }, message: string, data: {} }, [
        "code",
        "message",
      ]),
      code: {
        type: "string",
        pattern: "^HTTP_[0-9]{3}$",
        description:
          "HTTP error code added by the application transport, when applicable.",
      },
    },
    additionalProperties: false,
  },
};
const header = (name, description, required = false) => ({
  name,
  in: "header",
  required,
  schema: string,
  description,
});
/** @param {string} name @param {Record<string, any>} [schema] @param {boolean} [required] */
const query = (name, schema = string, required = false) => ({
  name,
  in: "query",
  required,
  schema,
});
const cookieHeader = {
  description:
    "Rotated session, pending challenge or form cookie; HttpOnly, SameSite=Lax, Secure on HTTPS.",
  schema: string,
};
const response = (schema, description = "Success") => ({
  description,
  content: content(schema),
});
const htmlResponse = {
  description: "Rendered browser page",
  content: { "text/html": { schema: string } },
};
const redirectResponse = {
  description: "Continue at Location",
  headers: { Location: { schema: string }, "Set-Cookie": cookieHeader },
};
const oauthRequest = {
  client_id: string,
  redirect_uri: { type: "string", format: "uri" },
  response_type: { const: "code" },
  code_challenge_method: { const: "S256" },
  code_challenge: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
  resource: {
    type: "string",
    format: "uri",
    description: "Configured origin plus /mcp",
  },
  scope: { type: "string", default: "wiki:read" },
  state: { type: "string", maxLength: 2048 },
};
const oauthRequired = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge_method",
  "code_challenge",
  "resource",
];

function completeContract(paths) {
  const success = {
    "health.live": record({ status: { const: "ok" } }),
    "contract.read": record({
      openapi: { const: "3.1.0" },
      info: object,
      paths: object,
      components: object,
    }),
    "articles.catalog": array(ref("ArticleMetadata")),
    "articles.authoring": ref("Authoring"),
    "wiki.history": record({ id: string, revisions: array(ref("Revision")) }),
    "wiki.traces": {
      anyOf: [
        array(ref("TraceMetadata")),
        schemaPage("snapshots", ref("TraceMetadata")),
        ref("EvidenceCatalog"),
      ],
    },
    "wiki.traceSessions": {
      anyOf: [schemaPage("sessions"), ref("EvidenceCatalog")],
    },
    "wiki.trace": { anyOf: [ref("TracePage"), ref("Conversation")] },
    "wiki.traceLines": ref("TraceLines"),
    "wiki.traceProvenance": ref("Provenance"),
    "wiki.file": ref("Attachment"),
    "identity.read": ref("Identity"),
    "run.read": ref("Run"),
    "run.close": record({ stopped: { const: true } }),
    "agents.list": record({ agents: array(ref("Agent")) }),
    "agents.manage": {
      anyOf: [
        record({ definition: string }),
        record({ saved: { const: true } }),
      ],
    },
    "access.list": ref("Access"),
    "access.grant": record({ saved: { const: true } }),
    "accounts.invite": record({ id: string, url: string }),
    "accounts.login": ref("SignIn"),
    "accounts.setup": ref("SignIn"),
    "accounts.password": record({ saved: { const: true } }),
    "accounts.logout": record({ signedOut: { const: true } }),
    "accounts.security": ref("Security"),
    "accounts.securityChange": ref("SecurityChange"),
    "accounts.verifyCode": record({
      signedIn: { const: true },
      redirect: string,
    }),
    "accounts.verifyPasskey": record({
      signedIn: { const: true },
      redirect: string,
    }),
    "accounts.passkeyOptions": record({ flow: string, options: object }),
    "oauth.resource": ref("OAuthResource"),
    "oauth.resourceAlias": ref("OAuthResource"),
    "oauth.metadata": ref("OAuthMetadata"),
    "oauth.register": ref("OAuthClient"),
    "oauth.token": ref("Token"),
    "oauth.revoke": fields({}),
  };
  for (const item of Object.values(paths))
    for (const spec of Object.values(item)) {
      if (success[spec.operationId]) {
        const status = ["accounts.invite", "oauth.register"].includes(
          spec.operationId,
        )
          ? "201"
          : "200";
        spec.responses[status] = response(success[spec.operationId]);
      }
      if (spec.operationId === "agents.manage")
        spec.responses["201"] = response(
          ref("Agent"),
          "Created agent; no implicit wiki grant",
        );
    }
  // These are HTTP endpoints too, including browser auth callbacks and JSON aliases.
  /** @param {string} method @param {string} path @param {string} id @param {string} permission @param {string} description @param {Record<string, any>} [schema] */
  function add(method, path, id, permission, description, schema = object) {
    const spec = entry(id, description, permission, schema);
    spec.parameters = parameters(
      {
        properties: Object.fromEntries(
          [...path.matchAll(/\{([^}]+)\}/g)].map((m) => [m[1], string]),
        ),
      },
      path,
    );
    (paths[path] ??= {})[method] = spec;
    return spec;
  }
  const consent = add(
    "get",
    "/oauth/authorize",
    "oauth.consent",
    "human",
    "Show the registered client's request and explicitly select an invokable agent. A signed-out browser is sent through sign-in.",
  );
  consent.parameters = parameters(
    { properties: oauthRequest, required: oauthRequired },
    "/oauth/authorize",
  );
  consent.responses["200"] = htmlResponse;
  const approve = add(
    "post",
    "/oauth/authorize",
    "oauth.approve",
    "human",
    "Approve or deny a PKCE request as the current human. Returns a redirect URL, not an HTTP redirect; code lifetime is 60 seconds. Approval rechecks agent invocation and current scopes.",
    record({ redirect: string }),
  );
  approve.requestBody = {
    required: true,
    content: {
      "application/x-www-form-urlencoded": {
        schema: fields(
          {
            ...oauthRequest,
            csrf: string,
            agent: string,
            decision: { enum: ["allow", "deny"] },
          },
          [...oauthRequired, "csrf", "decision"],
        ),
      },
    },
  };
  approve.parameters.push(
    header("Origin", "Must equal configured origin", true),
  );
  /** @type {Array<[string, string, string, any[]]>} */
  const signInRoutes = [
    [
      "/auth/sign-in",
      "accounts.signInPage",
      "Choose local or federated primary sign-in; issues a cookie-bound form token.",
      [query("mode", { const: "local" }), query("return_to")],
    ],
    [
      "/auth/local/setup",
      "accounts.setupPage",
      "Local invitation form. Invitation token is a URL fragment, not a query parameter.",
      [],
    ],
    [
      "/auth/mfa",
      "accounts.challengePage",
      "Pending second-factor challenge; redirects to sign-in if expired.",
      [],
    ],
    [
      "/auth/login",
      "accounts.oidcBegin",
      "Begin configured OIDC sign-in, setting a short-lived wiki_login cookie. No content grant is implied.",
      [query("return_to")],
    ],
    [
      "/auth/callback",
      "accounts.oidcCallback",
      "Provider callback; validates stored state and PKCE before establishing a session or MFA challenge. Provider errors render sign-in again.",
      [
        query("code"),
        query("state"),
        query("iss"),
        query("error"),
        query("error_description"),
      ],
    ],
  ];
  for (const [path, id, description, params] of signInRoutes) {
    const spec = add("get", path, id, "public", description);
    spec.parameters = params;
    spec.responses["200"] = {
      ...htmlResponse,
      headers: { "Set-Cookie": cookieHeader },
    };
    spec.responses["303"] = redirectResponse;
    if (id === "accounts.oidcBegin") {
      delete spec.responses["200"];
      spec.responses["503"].content["text/html"] = { schema: string };
    }
    if (id === "accounts.oidcCallback") {
      delete spec.responses["200"];
      spec.responses["400"].content["text/html"] = { schema: string };
    }
  }
  const evidenceAlias = add(
    "get",
    "/conversations/{id}/{kind}.json",
    "evidence.conversationKind",
    "trace",
    "External-evidence conversation JSON alias. The path selects kind; all other evidence selectors retain the same semantics.",
    ref("Conversation"),
  );
  evidenceAlias.parameters = paths[
    "/api/traces/{id}.json"
  ].get.parameters.filter((p) => !["id", "kind", "view"].includes(p.name));
  evidenceAlias.parameters.push(
    {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", pattern: "^chat-[a-f0-9]{24}$" },
    },
    {
      name: "kind",
      in: "path",
      required: true,
      schema: {
        enum: [
          "dialogue",
          "tool",
          "thinking",
          "reasoning",
          "context",
          "analysis",
        ],
      },
    },
  );
  paths["/api/traces/{id}.json"].get.parameters.push(
    query("attachments", {
      enum: ["metadata", "preview"],
      default: "metadata",
      description:
        "External evidence only; ordinary reads do not return attachment content.",
    }),
  );
  evidenceAlias.parameters.push(
    query("attachments", {
      enum: ["metadata", "preview"],
      default: "metadata",
    }),
  );
  // HTTP accepts empty search queries and provider pagination beyond the narrower tool defaults.
  paths["/api/articles/search"].get.parameters.find(
    (p) => p.name === "q",
  ).required = false;
  for (const path of [
    "/api/traces/search",
    "/api/traces/catalog.json",
    "/api/traces/sessions.json",
  ]) {
    for (const p of paths[path].get.parameters) {
      p.required = false;
      if (p.name === "format")
        p.schema = { ...p.schema, enum: ["", "codex", "pi", "claude"] };
      if (p.name === "limit")
        p.schema = {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "External evidence: up to 100; local trace search: up to 40; local catalogs: up to 100.",
        };
      if (p.name === "offset")
        p.schema = {
          type: "integer",
          minimum: 0,
          maximum: 1000000,
          description:
            "External evidence: up to 1000000; local archive: up to 10000.",
        };
    }
  }
  for (const p of [
    query("machine", { type: "string", maxLength: 100 }),
    query("q", { type: "string", maxLength: 300 }),
  ])
    paths["/api/traces/sessions.json"].get.parameters.push(p);
  const navigation = [
    ["/", "home", "read", [query("range", { enum: ["today", "week", "all"] })]],
    [
      "/wiki/",
      "topics",
      "read",
      [query("topic"), query("sort", { enum: ["title", "updated"] })],
    ],
    ["/new/", "create", "read", []],
    ["/wiki/{id}/", "article", "read", []],
    ["/wiki/{id}/revision/{revision}/", "revision", "read", []],
    ...["history", "edit", "compare", "sources"].map((view) => [
      `/wiki/{id}/${view}/`,
      view,
      "read",
      view === "compare"
        ? [query("from", integer), query("to", integer)]
        : view === "sources"
          ? [query("revision", integer)]
          : [],
    ]),
    [
      "/search/",
      "search",
      "read",
      [
        ...paths["/api/articles/search"].get.parameters,
        query("type", { enum: ["all", "articles", "traces"] }),
        query("traceOffset", integer),
        query("format"),
        query("machine"),
        query("sync", { const: "1" }),
      ],
    ],
    [
      "/traces/",
      "traces",
      "trace",
      [
        ...paths["/api/traces/catalog.json"].get.parameters,
        query("view", { enum: ["sessions", "snapshots"] }),
      ],
    ],
    [
      "/traces/{id}/",
      "trace",
      "trace",
      [query("page", { type: "integer", minimum: 1 })],
    ],
    [
      "/traces/provenance/",
      "provenance",
      "trace",
      paths["/api/traces/provenance.json"].get.parameters,
    ],
    [
      "/conversations/{id}/",
      "conversation",
      "trace",
      [
        ...evidenceAlias.parameters.filter((p) => p.in === "query"),
        query(
          "kind",
          evidenceAlias.parameters.find((p) => p.name === "kind").schema,
        ),
      ],
    ],
    ["/files/{asset}/", "file", "trace", []],
    ["/account/", "account", "human", []],
    ["/account/security/", "security", "human", []],
    ["/agents/", "agents", "human", []],
    ["/access/", "access", "manager", []],
  ];
  for (const [path, id, permission, params] of navigation) {
    const spec = add(
      "get",
      path,
      `browser.${id}`,
      permission,
      "Rendered browser navigation. Signed-out humans receive sign-in HTML or a redirect; machine credentials use the corresponding JSON API, except protected evidence routes.",
    );
    spec.parameters.push(...params);
    if (id === "create")
      spec.description +=
        " Creation requires writes enabled and editor/manager authority; otherwise a read-only page is shown. The form calls POST /api/articles/edits with expected_revision_id null, not a separate writer.";
    spec.responses["200"] = htmlResponse;
    spec.responses["303"] = redirectResponse;
    if (
      [
        "home",
        "topics",
        "create",
        "article",
        "revision",
        "history",
        "edit",
        "compare",
        "sources",
        "search",
        "traces",
        "trace",
        "provenance",
        "conversation",
        "file",
      ].includes(id)
    ) {
      spec.description +=
        " Browser document requests accepting text/html receive non-disclosing HTML recovery pages on errors; JSON clients retain structured errors.";
      for (const [status, result] of Object.entries(spec.responses))
        if (Number(status) >= 400)
          result.content = { ...result.content, ...htmlResponse.content };
    }
    spec.security =
      permission === "trace"
        ? [{ browserSession: [] }, { bearerAuth: [] }]
        : [{ browserSession: [] }];
  }
  const alias = add(
    "get",
    "/conversations/",
    "browser.conversations",
    "trace",
    "External archive catalog alias; preserves query string.",
  );
  alias.parameters = paths["/traces/"].get.parameters;
  alias.responses = { ...alias.responses, 302: redirectResponse };
  delete alias.responses["200"];
  for (const [status, result] of Object.entries(alias.responses))
    if (Number(status) >= 400)
      result.content = { ...result.content, ...htmlResponse.content };
  const asset = add(
    "get",
    "/assets/{asset}",
    "browser.asset",
    "public",
    "Built-in browser assets and vendor/<bundle>.js or vendor/licenses.txt. Asset may contain a slash; arbitrary paths are not served.",
  );
  asset.responses["200"] = {
    description: "Browser asset",
    content: Object.fromEntries(
      [
        "text/javascript",
        "text/css",
        "text/html",
        "text/plain",
        "image/svg+xml",
      ].map((type) => [type, { schema: string }]),
    ),
  };
  const vendorAsset = structuredClone(asset);
  vendorAsset.operationId = "browser.vendorAsset";
  vendorAsset.description =
    "Built browser JavaScript bundles and license notices; generated by npm ci from locked dependencies.";
  paths["/assets/vendor/{asset}"] = { get: vendorAsset };
  for (const path of ["/mcp", "/mcp/"])
    for (const method of ["get", "post"]) {
      const spec = add(
        method,
        path,
        `mcp.${method}${path.endsWith("/") ? "Alias" : ""}`,
        "read",
        "Stateless Streamable HTTP MCP transport. Tool discovery is filtered by current write/evidence authority; tool calls recheck it. JSON-RPC tool errors may be returned in a successful HTTP response. GET has no standalone event stream in this stateless implementation.",
      );
      spec.parameters.push(
        header("Accept", "application/json, text/event-stream", true),
        header("MCP-Protocol-Version", "Negotiated MCP version"),
      );
      spec.responses["200"] = {
        description: "JSON-RPC response or event stream",
        content: {
          ...content(ref("JsonRpc")),
          "text/event-stream": { schema: string },
        },
      };
      spec.responses["202"] = {
        description: "Accepted notification; no response body",
      };
      if (method === "post")
        spec.requestBody = { required: true, content: content(ref("JsonRpc")) };
      else {
        delete spec.responses["200"];
        delete spec.responses["202"];
      }
      for (const code of [400, 405, 406, 415])
        spec.responses[code] = response(
          { anyOf: [ref("Error"), ref("JsonRpcError")] },
          "Transport or JSON-RPC error",
        );
    }
  // Common policy is explicit on each operation; no security is inferred from tags.
  for (const [path, item] of Object.entries(paths))
    for (const [method, spec] of Object.entries(item)) {
      const id = spec.operationId;
      if (["accounts.login", "accounts.setup"].includes(id))
        spec.security = [{ localForm: [] }];
      if (
        [
          "accounts.verifyCode",
          "accounts.verifyPasskey",
          "accounts.passkeyOptions",
        ].includes(id)
      )
        spec.security = [{ pendingMfa: [] }];
      if (
        spec.security.some((s) => s.localForm || s.pendingMfa) ||
        (method === "post" &&
          ["human", "manager"].includes(spec["x-wiki-permission"]))
      ) {
        for (const p of spec.parameters)
          if (["Origin", "X-Wiki-CSRF"].includes(p.name)) p.required = true;
      }
      spec.summary = id.replaceAll(".", " ");
      spec.tags = [
        id.startsWith("browser.")
          ? "Browser"
          : id.startsWith("mcp.")
            ? "MCP"
            : path.startsWith("/oauth/") || path.startsWith("/.well-known/")
              ? "OAuth"
              : /trace|evidence|file/.test(id)
                ? "Evidence"
                : /accounts|identity/.test(id)
                  ? "Accounts"
                  : id.startsWith("access.")
                    ? "Access"
                    : /agents|run/.test(id)
                      ? "Agents"
                      : /wiki|article/.test(id)
                        ? "Articles"
                        : "Service",
      ];
      if (method === "post" && id !== "oauth.approve") {
        if (!spec.parameters.some((p) => p.name === "Origin"))
          spec.parameters.push(
            header(
              "Origin",
              "Required with cookies; when present must equal configured origin.",
              !path.startsWith("/oauth/") &&
                !id.startsWith("mcp.") &&
                !id.startsWith("wiki."),
            ),
          );
        if (!path.startsWith("/oauth/")) {
          if (!spec.parameters.some((p) => p.name === "X-Wiki-CSRF"))
            spec.parameters.push(
              header(
                "X-Wiki-CSRF",
                "Required with human session, pending MFA or local form cookies. Bearer clients do not send a CSRF token.",
                !id.startsWith("mcp.") && !id.startsWith("wiki."),
              ),
            );
        }
      }
      for (const [status, result] of Object.entries(spec.responses)) {
        if (result.content?.["application/json"]?.schema === error)
          result.content["application/json"] = { schema: ref("Error") };
        result.headers = {
          "Cache-Control": { schema: { const: "no-store" } },
          "X-Content-Type-Options": { schema: { const: "nosniff" } },
          ...result.headers,
        };
        if (status === "401")
          result.headers["WWW-Authenticate"] = {
            description:
              "Bearer challenge with protected-resource metadata when using machine authentication.",
            schema: string,
          };
        if (
          status.startsWith("2") &&
          /^(accounts\.(login|setup|logout|password|securityChange|verifyCode|verifyPasskey))$/.test(
            id,
          )
        )
          result.headers["Set-Cookie"] = cookieHeader;
      }
      if (spec["x-wiki-permission"] === "trace")
        spec.description +=
          " Requires Conversations enabled and editorial evidence authority. CONVERSATIONS_DISABLED returns 404; unavailable archives return 503. An article link never grants access to original evidence.";
    }
  // The CLI owns a separate, short-lived HTTP listener, not a wiki-server route.
  paths["/callback"] = {
    servers: [
      {
        url: "http://127.0.0.1:{port}",
        description:
          "CLI browser-login listener on an OS-assigned loopback port; never the wiki origin. Available only while login is pending. Port 49152 is illustrative; use the exact redirect_uri registered by this CLI login attempt.",
        variables: { port: { default: "49152" } },
      },
    ],
    get: {
      operationId: "cli.oauthCallback",
      summary: "Complete pending CLI browser authorization",
      tags: ["CLI"],
      description:
        "Accepts only GET /callback with the exact registered Host and random pending state. Invalid requests do not finish login. A matching callback tells the browser to return to the terminal; HTTP 200 is not proof of successful authorization. The CLI then rejects provider errors or a missing code and uses the SDK to verify issuer and exchange the code with PKCE. The listener closes after completion or timeout (five minutes by default). No credentials are returned to the browser.",
      security: [],
      parameters: [
        header("Host", "Exact 127.0.0.1:<assigned-port> authority", true),
        query(
          "state",
          { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
          true,
        ),
        query("code"),
        query("iss", { type: "string", format: "uri" }),
        query("error"),
      ],
      responses: {
        200: {
          description:
            "Matching callback received; inspect the terminal for the eventual login result.",
          content: {
            "text/plain": {
              schema: {
                const: "Return to the terminal to check login completion.",
              },
            },
          },
          headers: {
            "Cache-Control": { schema: { const: "no-store" } },
            "Referrer-Policy": { schema: { const: "no-referrer" } },
          },
        },
        400: {
          description:
            "Invalid method, path, Host or state; login remains pending.",
          content: {
            "text/plain": { schema: { const: "Invalid login callback" } },
          },
        },
      },
    },
  };
  const save = paths["/api/articles/edits"].post;
  save.responses["200"].content = content(ref("SaveReceipt"));
  save.responses["200"].description =
    "Durable receipt; inspect remote and publication independently. An uncertain request must be retried with its exact operation_id and input.";
  save.description +=
    " JSON requests are limited to 512000 bytes. Revision or operation-input conflicts return 409; writer unavailability returns 503. A committed save can return publication=refresh-failed and remains recoverable.";
  paths["/api/articles/preview"].post.description +=
    " JSON requests are limited to 512000 bytes. No Git write or model call occurs.";
  paths["/api/evidence/v1/{route}"].get.parameters.push(
    header("Range", "Optional byte range forwarded to the evidence provider"),
  );
  const providerResponse = {
    description:
      "Upstream provider status, body and content type are forwarded after authorization; only allowlisted response headers pass through. Engine failures use the Error schema; provider errors retain their original format.",
    content: {
      "application/json": { schema: {} },
      "*/*": { schema: { type: "string", format: "binary" } },
    },
  };
  for (const path of ["/api/evidence/v1/{route}", "/media/{asset}"]) {
    paths[path].get.responses.default = providerResponse;
    for (const result of Object.values(paths[path].get.responses))
      result.content = providerResponse.content;
  }
  for (const path of ["/media/{asset}", "/article-media/{asset}"])
    for (const status of ["200", "206", "416"]) {
      const result = paths[path].get.responses[status];
      result.headers = {
        ...result.headers,
        "Content-Length": { schema: { type: "integer", minimum: 0 } },
        "Content-Range": { schema: string },
        "Accept-Ranges": { schema: { const: "bytes" } },
        "Content-Disposition": {
          description: "Attachment filename when download is supplied",
          schema: string,
        },
      };
    }
  save.requestBody.content["application/json"].example = {
    operation_id: "first-guide",
    updates: [
      {
        id: "guide",
        expected_revision_id: null,
        title: "Guide",
        description: "A synthetic guide",
        topic: "Getting started",
        body: "# Guide\n\nVerified knowledge.\n",
        summary: "Create guide",
      },
    ],
  };
}
