import { permits as rolePermits } from "./authorization.mjs";
import { randomUUID } from "node:crypto";
import { digest, secret } from "./control-store.mjs";
import { WikiError } from "./errors.mjs";

const actions = new Set(["read", "write", "trace"]);
const controls = new Set(["invoke", "configure", "manage-access"]);
const fail = () => {
  throw new WikiError("NOT_FOUND", "Not found", 404);
};
function text(value, maximum = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new WikiError("INVALID_AGENT", "Invalid agent input", 400);
  return value;
}
function scope(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new WikiError(
      "INVALID_SCOPE",
      "Specify permitted spaces and actions",
      400,
    );
  const seen = new Set();
  return value
    .map((entry) => {
      if (
        !entry ||
        typeof entry.space !== "string" ||
        !Array.isArray(entry.actions) ||
        !entry.actions.length ||
        entry.actions.some((a) => !actions.has(a)) ||
        seen.has(entry.space)
      )
        throw new WikiError(
          "INVALID_SCOPE",
          "Invalid or duplicate space scope",
          400,
        );
      seen.add(entry.space);
      return {
        space: entry.space,
        actions: [...new Set(entry.actions)].sort(),
      };
    })
    .sort((a, b) => a.space.localeCompare(b.space));
}
function expiry(value, now, maximum = 365 * 86400000) {
  if (!Number.isSafeInteger(value) || value <= now || value > now + maximum)
    throw new WikiError(
      "INVALID_EXPIRY",
      "Expiry must be within the next year",
      400,
    );
  return value;
}
const permits = (entries, space, action) =>
  entries.some((e) => e.space === space && e.actions.includes(action));

/** Durable agent identity and authority. The runtime, not the wiki, executes runs. */
export class AgentStore {
  constructor(control, { now = () => Date.now() } = {}) {
    this.control = control;
    this.db = control.db;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY REFERENCES principals(id), owner TEXT NOT NULL REFERENCES principals(id), definition TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_definitions(id TEXT PRIMARY KEY, agent TEXT NOT NULL REFERENCES agents(id), config TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_permissions(agent TEXT NOT NULL REFERENCES agents(id), principal TEXT NOT NULL REFERENCES principals(id), permission TEXT NOT NULL CHECK(permission IN ('invoke','configure','manage-access')), PRIMARY KEY(agent,principal,permission));
      CREATE TABLE IF NOT EXISTS agent_keys(agent TEXT NOT NULL REFERENCES agents(id), kid TEXT NOT NULL, jwk TEXT NOT NULL, authorization TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(agent,kid));
      CREATE TABLE IF NOT EXISTS agent_delegations(id TEXT PRIMARY KEY, agent TEXT NOT NULL REFERENCES agents(id), subject TEXT NOT NULL REFERENCES principals(id), scope TEXT NOT NULL, expires INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, agent TEXT NOT NULL REFERENCES agents(id), initiator TEXT NOT NULL REFERENCES principals(id), mode TEXT NOT NULL CHECK(mode IN ('delegated','independent')), delegation TEXT REFERENCES agent_delegations(id), definition TEXT NOT NULL REFERENCES agent_definitions(id), scope TEXT NOT NULL, trace_space TEXT NOT NULL REFERENCES spaces(id), expires INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, runtime_key TEXT);
      CREATE TABLE IF NOT EXISTS agent_tokens(hash TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES agent_runs(id), kid TEXT NOT NULL, audience TEXT NOT NULL, scope TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_assertions(agent TEXT NOT NULL, jti TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(agent,jti));
      CREATE TABLE IF NOT EXISTS agent_enrollments(agent TEXT NOT NULL, kid TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(agent,kid));
      CREATE TABLE IF NOT EXISTS remote_clients(id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_codes(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), agent TEXT NOT NULL REFERENCES agents(id), request TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_grants(id TEXT PRIMARY KEY, client TEXT NOT NULL REFERENCES remote_clients(id), principal TEXT NOT NULL REFERENCES principals(id), agent TEXT NOT NULL REFERENCES agents(id), run TEXT NOT NULL REFERENCES agent_runs(id), scope TEXT NOT NULL, expires INTEGER NOT NULL, active INTEGER NOT NULL, audience TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_tokens(hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES remote_grants(id), kind TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS remote_token_expiry ON remote_tokens(expires);
      CREATE INDEX IF NOT EXISTS agent_token_expiry ON agent_tokens(expires);
    `);
  }
  /** Operator enrollment is a durable, repeatable registration of public material. */
  enrollOperator(spec, owner, role = "reader", mode = "independent") {
    if (
      !spec ||
      spec.version !== 1 ||
      !/^[a-f0-9-]{36}$/.test(spec.agent) ||
      typeof spec.key !== "string" ||
      spec.key.length > 100 ||
      !["reader", "editor"].includes(role) ||
      !["independent", "delegated"].includes(mode)
    )
      throw new WikiError("INVALID_AGENT", "Invalid registration", 400);
    this.human(owner);
    const name = text(spec.name);
    const config = this.definition(spec.definition);
    const entries = scope([
      {
        space: "default",
        actions: role === "editor" ? ["read", "trace", "write"] : ["read"],
      },
    ]);
    const expires =
      spec.expiresAt === null && mode === "independent"
        ? null
        : expiry(Date.parse(spec.expiresAt), this.now());
    const fingerprint = digest(JSON.stringify({ spec, owner, role, mode }));
    return this.control.transaction(() => {
      const existing = this.db
        .prepare("SELECT hash FROM agent_enrollments WHERE agent=? AND kid=?")
        .get(spec.agent, spec.key);
      if (existing) {
        if (existing.hash !== fingerprint)
          throw new WikiError(
            "REGISTRATION_CONFLICT",
            "Registration changed; rotate to a new key ID",
            409,
          );
        this.key(spec.agent, spec.key);
        return {
          agent: spec.agent,
          key: spec.key,
          changed: false,
          expiresAt: spec.expiresAt,
        };
      }
      const a = this.db
        .prepare(
          "SELECT a.*,p.name FROM agents a JOIN principals p ON p.id=a.id WHERE a.id=?",
        )
        .get(spec.agent);
      if (a) {
        if (
          a.owner !== owner ||
          a.name !== name ||
          this.db
            .prepare("SELECT config FROM agent_definitions WHERE id=?")
            .get(a.definition).config !== config
        )
          throw new WikiError(
            "REGISTRATION_CONFLICT",
            "Existing agent definition or owner differs",
            409,
          );
        this.get(spec.agent);
      } else {
        const definition = randomUUID();
        this.db
          .prepare("INSERT INTO principals(id,kind,name) VALUES (?,'agent',?)")
          .run(spec.agent, name);
        this.db
          .prepare("INSERT INTO agents VALUES (?,?,?)")
          .run(spec.agent, owner, definition);
        this.db
          .prepare("INSERT INTO agent_definitions VALUES (?,?,?,?)")
          .run(definition, spec.agent, config, this.now());
        this.record("operator", "agent:create", spec.agent);
      }
      let delegation = null;
      if (mode === "independent") {
        this.db
          .prepare(
            "INSERT INTO grants VALUES ('default',?,?) ON CONFLICT(space,principal) DO UPDATE SET role=excluded.role",
          )
          .run(spec.agent, role);
        this.record("operator", "grant:" + role, spec.agent);
      } else {
        this.validateScope(owner, entries);
        delegation = randomUUID();
        this.db
          .prepare(
            "INSERT INTO agent_delegations(id,agent,subject,scope,expires) VALUES (?,?,?,?,?)",
          )
          .run(delegation, spec.agent, owner, JSON.stringify(entries), expires);
        this.record("operator", "agent:delegate", delegation);
      }
      this.installKey(spec.agent, spec.key, spec.publicKey, {
        initiator: owner,
        mode,
        delegation,
        scope: entries,
        traceSpace: "default",
        expires,
      });
      this.db
        .prepare("INSERT INTO agent_enrollments VALUES (?,?,?)")
        .run(spec.agent, spec.key, fingerprint);
      return {
        agent: spec.agent,
        key: spec.key,
        changed: true,
        expiresAt: spec.expiresAt,
      };
    });
  }
  principal(id) {
    return (
      this.db
        .prepare("SELECT * FROM principals WHERE id=? AND active=1")
        .get(id) || fail()
    );
  }
  human(id) {
    const p = this.principal(id);
    if (p.kind !== "human") fail();
    return p;
  }
  record(actor, action, target) {
    this.db
      .prepare("INSERT INTO audit(actor,action,target) VALUES (?,?,?)")
      .run(actor, action, target);
  }
  get(id) {
    return (
      this.db
        .prepare(
          "SELECT a.*,p.name FROM agents a JOIN principals p ON p.id=a.id WHERE a.id=? AND p.active=1",
        )
        .get(id) || fail()
    );
  }
  allowed(actor, agent, permission) {
    this.principal(actor);
    const a = this.get(agent);
    return (
      a.owner === actor ||
      !!this.db
        .prepare(
          "SELECT 1 FROM agent_permissions WHERE agent=? AND principal=? AND permission=?",
        )
        .get(agent, actor, permission)
    );
  }
  require(actor, agent, permission) {
    if (!this.allowed(actor, agent, permission)) fail();
  }
  list(actor) {
    this.human(actor);
    return this.db
      .prepare(
        "SELECT a.*,p.name,p.active FROM agents a JOIN principals p ON p.id=a.id WHERE a.owner=? OR EXISTS (SELECT 1 FROM agent_permissions g WHERE g.agent=a.id AND g.principal=?) ORDER BY p.name",
      )
      .all(actor, actor);
  }
  definition(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.instructions !== "string" ||
      value.instructions.length > 20000 ||
      !Array.isArray(value.tools) ||
      value.tools.length > 100 ||
      value.tools.some((t) => typeof t !== "string" || t.length > 200) ||
      Object.keys(value).some((k) => !["instructions", "tools"].includes(k))
    )
      throw new WikiError(
        "INVALID_DEFINITION",
        "Specify instructions and tool names only; credentials do not belong in definitions",
        400,
      );
    return JSON.stringify(value);
  }
  create(actor, { name, definition }) {
    this.human(actor);
    name = text(name);
    const config = this.definition(definition);
    return this.control.transaction(() => {
      const id = randomUUID(),
        version = randomUUID();
      this.db
        .prepare("INSERT INTO principals(id,kind,name) VALUES (?,'agent',?)")
        .run(id, name);
      this.db
        .prepare("INSERT INTO agents VALUES (?,?,?)")
        .run(id, actor, version);
      this.db
        .prepare("INSERT INTO agent_definitions VALUES (?,?,?,?)")
        .run(version, id, config, this.now());
      this.record(actor, "agent:create", id);
      return this.get(id);
    });
  }
  configure(actor, agent, definition) {
    const config = this.definition(definition);
    return this.control.transaction(() => {
      this.require(actor, agent, "configure");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO agent_definitions VALUES (?,?,?,?)")
        .run(id, agent, config, this.now());
      this.db
        .prepare("UPDATE agents SET definition=? WHERE id=?")
        .run(id, agent);
      this.record(actor, "agent:configure", agent);
      return { definition: id };
    });
  }
  permission(actor, agent, principal, permission, enabled) {
    if (!controls.has(permission) || typeof enabled !== "boolean")
      throw new WikiError(
        "INVALID_PERMISSION",
        "Invalid agent permission",
        400,
      );
    return this.control.transaction(() => {
      this.require(actor, agent, "manage-access");
      this.human(principal);
      if (enabled)
        this.db
          .prepare("INSERT OR IGNORE INTO agent_permissions VALUES (?,?,?)")
          .run(agent, principal, permission);
      else
        this.db
          .prepare(
            "DELETE FROM agent_permissions WHERE agent=? AND principal=? AND permission=?",
          )
          .run(agent, principal, permission);
      if (!enabled && permission === "invoke") {
        this.db
          .prepare(
            "UPDATE remote_grants SET active=0 WHERE agent=? AND principal=?",
          )
          .run(agent, principal);
      }
      this.record(
        actor,
        "agent:permission:" + permission + ":" + enabled,
        agent + ":" + principal,
      );
    });
  }
  transfer(actor, agent, owner) {
    return this.control.transaction(() => {
      this.require(actor, agent, "manage-access");
      this.human(owner);
      this.db.prepare("UPDATE agents SET owner=? WHERE id=?").run(owner, agent);
      this.record(actor, "agent:owner", agent + ":" + owner);
    });
  }
  suspend(actor, agent) {
    return this.control.transaction(() => {
      this.require(actor, agent, "manage-access");
      this.db.prepare("UPDATE principals SET active=0 WHERE id=?").run(agent);
      this.db
        .prepare("UPDATE agent_runs SET active=0 WHERE agent=?")
        .run(agent);
      this.record(actor, "agent:suspend", agent);
    });
  }
  role(principal, space) {
    return this.control.role(principal, space);
  }
  hasSpace(principal, space, action) {
    const role = this.role(principal, space);
    return rolePermits(role, action);
  }
  validateScope(principal, entries) {
    for (const entry of entries)
      for (const action of entry.actions)
        if (!this.hasSpace(principal, entry.space, action)) fail();
  }
  delegate(actor, agent, input) {
    const entries = scope(input.scope),
      expires = expiry(input.expires, this.now());
    return this.control.transaction(() => {
      this.human(actor);
      this.require(actor, agent, "invoke");
      this.validateScope(actor, entries);
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO agent_delegations(id,agent,subject,scope,expires) VALUES (?,?,?,?,?)",
        )
        .run(id, agent, actor, JSON.stringify(entries), expires);
      this.record(actor, "agent:delegate", id);
      return { id, agent, subject: actor, scope: entries, expires };
    });
  }
  delegation(id, agent) {
    const d = this.db
      .prepare(
        "SELECT * FROM agent_delegations WHERE id=? AND agent=? AND active=1 AND expires>?",
      )
      .get(id, agent, this.now());
    if (!d) fail();
    this.human(d.subject);
    return { ...d, scope: JSON.parse(d.scope) };
  }
  revokeDelegation(actor, id) {
    return this.control.transaction(() => {
      const d =
        this.db.prepare("SELECT * FROM agent_delegations WHERE id=?").get(id) ||
        fail();
      this.human(actor);
      if (actor !== d.subject) this.require(actor, d.agent, "manage-access");
      this.db
        .prepare("UPDATE agent_delegations SET active=0 WHERE id=?")
        .run(id);
      this.record(actor, "agent:revoke-delegation", id);
    });
  }
  start(actor, agent, input) {
    return this.control.transaction(() =>
      this.startRecord(actor, agent, input),
    );
  }
  startRecord(actor, agent, input) {
    const entries = scope(input.scope),
      expires = expiry(input.expires, this.now());
    if (!["delegated", "independent"].includes(input.mode))
      throw new WikiError(
        "INVALID_MODE",
        "Choose delegated or independent authority",
        400,
      );
    {
      this.human(actor);
      this.require(actor, agent, "invoke");
      const a = this.get(agent);
      let d = null;
      if (input.mode === "delegated") {
        d = this.delegation(input.delegation, agent);
        // A durable delegation may be scheduled by its subject or the agent owner,
        // never by another invoker who merely knows its identifier.
        if (d.subject !== actor && a.owner !== actor) fail();
        if (expires > d.expires) fail();
        for (const e of entries)
          for (const action of e.actions)
            if (!permits(d.scope, e.space, action)) fail();
        this.validateScope(d.subject, entries);
      } else {
        if (input.delegation != null) fail();
        this.validateScope(agent, entries);
      }
      // Trace storage is an explicit destination, not inferred from all readable
      // sources. This authorizes the destination; capture remains an integration.
      const traceSpace = text(input.traceSpace);
      if (
        traceSpace !== "default" ||
        !this.hasSpace(d?.subject || agent, traceSpace, "read")
      )
        fail();
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO agent_runs(id,agent,initiator,mode,delegation,definition,scope,trace_space,expires,created) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          agent,
          actor,
          input.mode,
          d?.id || null,
          a.definition,
          JSON.stringify(entries),
          traceSpace,
          expires,
          this.now(),
        );
      this.record(actor, "agent:start:" + input.mode, id);
      return this.run(id);
    }
  }
  run(id) {
    const r =
      this.db
        .prepare(
          "SELECT * FROM agent_runs WHERE id=? AND active=1 AND expires>?",
        )
        .get(id, this.now()) || fail();
    this.get(r.agent);
    if (r.runtime_key) this.key(r.agent, r.runtime_key);
    this.require(r.initiator, r.agent, "invoke");
    const d =
      r.mode === "delegated" ? this.delegation(r.delegation, r.agent) : null;
    return { ...r, scope: JSON.parse(r.scope), subject: d?.subject || null };
  }
  authorize(runId, space, action) {
    const r = this.run(runId);
    if (!permits(r.scope, space, action)) fail();
    if (r.mode === "delegated") {
      const d = this.delegation(r.delegation, r.agent);
      if (
        !permits(d.scope, space, action) ||
        !this.hasSpace(d.subject, space, action)
      )
        fail();
    } else if (!this.hasSpace(r.agent, space, action)) fail();
    return r;
  }
  stop(actor, id) {
    return this.control.transaction(() => {
      const r =
        this.db.prepare("SELECT * FROM agent_runs WHERE id=?").get(id) ||
        fail();
      this.human(actor);
      const subject = r.delegation
        ? this.db
            .prepare("SELECT subject FROM agent_delegations WHERE id=?")
            .get(r.delegation)?.subject
        : null;
      if (r.initiator !== actor && subject !== actor)
        this.require(actor, r.agent, "manage-access");
      this.db.prepare("UPDATE agent_runs SET active=0 WHERE id=?").run(id);
      this.record(actor, "agent:stop", id);
    });
  }
  /** Operator-only bootstrap: public keys never come from a token request. */
  installKey(agent, kid, jwk, authorization) {
    this.get(agent);
    text(kid, 100);
    const input = this.runtimeAuthorization(agent, authorization);
    if (
      !jwk ||
      jwk.d ||
      jwk.k ||
      jwk.p ||
      jwk.q ||
      jwk.oth ||
      jwk.jku ||
      jwk.x5u ||
      jwk.kty !== "RSA" ||
      jwk.alg !== "RS256" ||
      typeof jwk.n !== "string" ||
      Buffer.from(jwk.n, "base64url").length < 256 ||
      Buffer.from(jwk.n, "base64url").length > 1024 ||
      jwk.e !== "AQAB"
    )
      throw new WikiError(
        "INVALID_KEY",
        "An RSA 2048-bit or stronger RS256 public JWK is required",
        400,
      );
    if (
      this.db
        .prepare("SELECT 1 FROM agent_keys WHERE agent=? AND kid=?")
        .get(agent, kid)
    )
      throw new WikiError("KEY_EXISTS", "Use a new key ID for rotation", 409);
    this.db
      .prepare(
        "INSERT INTO agent_keys(agent,kid,jwk,authorization) VALUES (?,?,?,?)",
      )
      .run(
        agent,
        kid,
        JSON.stringify({ kty: "RSA", alg: "RS256", n: jwk.n, e: jwk.e, kid }),
        JSON.stringify(input),
      );
    this.record("operator", "agent:key", agent + ":" + kid);
  }
  runtimeAuthorization(agent, value) {
    if (!value || !["independent", "delegated"].includes(value.mode)) fail();
    this.human(value.initiator);
    this.require(value.initiator, agent, "invoke");
    const entries = scope(value.scope);
    const expires =
      value.expires === null && value.mode === "independent"
        ? null
        : expiry(value.expires, this.now());
    let subject = agent;
    if (value.mode === "delegated") {
      const d = this.delegation(value.delegation, agent);
      if (d.subject !== value.initiator || expires > d.expires) fail();
      for (const e of entries)
        for (const action of e.actions)
          if (!permits(d.scope, e.space, action)) fail();
      subject = d.subject;
    } else if (value.delegation != null) fail();
    this.validateScope(subject, entries);
    if (
      value.traceSpace !== "default" ||
      !this.hasSpace(subject, value.traceSpace, "read")
    )
      fail();
    return {
      initiator: value.initiator,
      mode: value.mode,
      delegation: value.delegation || null,
      scope: entries,
      expires,
      traceSpace: value.traceSpace,
    };
  }
  revokeKey(agent, kid) {
    this.db
      .prepare("UPDATE agent_keys SET active=0 WHERE agent=? AND kid=?")
      .run(agent, kid);
    this.record("operator", "agent:revoke-key", agent + ":" + kid);
  }
  key(agent, kid) {
    this.get(agent);
    const k =
      this.db
        .prepare(
          "SELECT jwk FROM agent_keys WHERE agent=? AND kid=? AND active=1",
        )
        .get(agent, kid) || fail();
    const authorization = JSON.parse(
      this.db
        .prepare("SELECT authorization FROM agent_keys WHERE agent=? AND kid=?")
        .get(agent, kid).authorization,
    );
    if (authorization.expires !== null && authorization.expires <= this.now())
      fail();
    this.require(authorization.initiator, agent, "invoke");
    return JSON.parse(k.jwk);
  }
  issue(
    agent,
    kid,
    runId,
    audience,
    requestedScope,
    jti,
    assertionExpires,
    runLifetimeSeconds = 86400,
  ) {
    return this.control.transaction(() => {
      this.key(agent, kid);
      if (
        !Number.isSafeInteger(runLifetimeSeconds) ||
        runLifetimeSeconds < 60 ||
        runLifetimeSeconds > 86400
      )
        fail();
      text(jti, 200);
      if (
        !Number.isSafeInteger(assertionExpires) ||
        assertionExpires <= this.now() ||
        assertionExpires > this.now() + 120000
      )
        fail();
      this.db
        .prepare("DELETE FROM agent_assertions WHERE expires<=?")
        .run(this.now());
      this.db
        .prepare("DELETE FROM agent_tokens WHERE expires<=?")
        .run(this.now());
      if (
        this.db
          .prepare("SELECT 1 FROM agent_assertions WHERE agent=? AND jti=?")
          .get(agent, jti)
      )
        fail();
      if (
        Number(
          this.db.prepare("SELECT count(*) n FROM agent_tokens").get().n,
        ) >= 10000 ||
        Number(
          this.db
            .prepare(
              "SELECT count(*) n FROM agent_tokens t JOIN agent_runs r ON r.id=t.run WHERE r.agent=?",
            )
            .get(agent).n,
        ) >= 100
      )
        throw new WikiError("AUTH_BUSY", "Too many active agent tokens", 429);
      let r;
      if (runId) r = this.run(text(runId));
      else {
        const authorization = JSON.parse(
          this.db
            .prepare(
              "SELECT authorization FROM agent_keys WHERE agent=? AND kid=?",
            )
            .get(agent, kid).authorization,
        );
        if (
          Number(
            this.db
              .prepare(
                "SELECT count(*) n FROM agent_runs WHERE agent=? AND active=1 AND expires>?",
              )
              .get(agent, this.now()).n,
          ) >= 100
        )
          throw new WikiError("AUTH_BUSY", "Too many active agent runs", 429);
        r = this.startRecord(authorization.initiator, agent, {
          ...authorization,
          expires: Math.min(
            authorization.expires ?? Infinity,
            this.now() + runLifetimeSeconds * 1000,
          ),
        });
        this.db
          .prepare("UPDATE agent_runs SET runtime_key=? WHERE id=?")
          .run(kid, r.id);
        r.runtime_key = kid;
      }
      if (r.agent !== agent || r.runtime_key !== kid) fail();
      runId = r.id;
      const entries = requestedScope ? scope(requestedScope) : r.scope;
      for (const entry of entries)
        for (const action of entry.actions)
          this.authorize(runId, entry.space, action);
      this.db
        .prepare("INSERT INTO agent_assertions VALUES (?,?,?)")
        .run(agent, jti, assertionExpires);
      const token = secret(),
        expires = Math.min(this.now() + 5 * 60000, r.expires);
      this.db
        .prepare("INSERT INTO agent_tokens VALUES (?,?,?,?,?,?)")
        .run(
          digest(token),
          runId,
          kid,
          audience,
          JSON.stringify(entries),
          expires,
        );
      this.record(agent, "agent:token", runId);
      return {
        access_token: token,
        token_type: "Bearer",
        wiki_run: runId,
        expires_in: Math.max(0, Math.floor((expires - this.now()) / 1000)),
      };
    });
  }
  authenticate(token, audience) {
    const row = this.db
      .prepare(
        "SELECT * FROM agent_tokens WHERE hash=? AND audience=? AND expires>?",
      )
      .get(digest(token), audience, this.now());
    if (!row) return this.authenticateRemote(token, audience);
    const r = this.run(row.run);
    this.key(r.agent, row.kid);
    const enrollment = JSON.parse(
      this.db
        .prepare("SELECT authorization FROM agent_keys WHERE agent=? AND kid=?")
        .get(r.agent, row.kid).authorization,
    );
    return {
      ...(enrollment.expires === null ? { credential: row.kid } : {}),
      id: r.agent,
      kind: "agent",
      run: r.id,
      subject: r.subject,
      mode: r.mode,
      definition: r.definition,
      scope: JSON.parse(row.scope),
      expires: row.expires,
    };
  }
  authenticateRemote(token, audience) {
    const row = this.db
      .prepare(
        "SELECT g.*,t.expires token_expires FROM remote_tokens t JOIN remote_grants g ON g.id=t.grant_id WHERE t.hash=? AND t.kind='access' AND t.expires>? AND g.expires>? AND g.active=1",
      )
      .get(digest(token), this.now(), this.now());
    if (!row || audience !== row.audience) fail();
    this.human(row.principal);
    const r = this.run(row.run);
    if (r.agent !== row.agent || r.initiator !== row.principal) fail();
    return {
      id: r.agent,
      kind: "agent",
      run: r.id,
      initiator: r.initiator,
      subject: r.subject,
      mode: r.mode,
      definition: r.definition,
      scope: r.scope,
      expires: row.token_expires,
    };
  }
  requireToken(token, audience, space, action) {
    const actor = this.authenticate(token, audience);
    if (!permits(actor.scope, space, action)) fail();
    this.authorize(actor.run, space, action);
    return actor;
  }
}
