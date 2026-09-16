import { createHash, randomUUID } from "node:crypto";
import { digest, secret } from "./control-store.mjs";
import { WikiError } from "./errors.mjs";
import { shell } from "./render.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentConsent } from "../ui/components/auth.mjs";

const scopeActions = {
  "wiki:read": "read",
  "wiki:trace": "trace",
  "wiki:write": "write",
};
const invalid = (code = "invalid_request", status = 400) => {
  throw new WikiError(code, code.replaceAll("_", " "), status);
};
export async function readOAuthForm(req) {
  if (
    req.headers["content-type"]?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  )
    invalid();
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) invalid("invalid_request", 413);
    chunks.push(chunk);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  for (const key of form.keys()) if (form.getAll(key).length !== 1) invalid();
  return form;
}
function redirectURI(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.hash || value.length > 2048) invalid();
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
      )
    )
      invalid();
    return u.href;
  } catch {
    invalid("invalid_redirect_uri");
  }
}

/** User-authenticated remote MCP connections. Opaque secrets are stored as hashes. */
export class RemoteAgents {
  constructor(agents, origin) {
    this.agents = agents;
    this.control = agents.control;
    this.db = agents.db;
    this.origin = origin;
    this.resource = origin + "/mcp";
  }
  metadata() {
    return {
      issuer: this.origin,
      authorization_endpoint: this.origin + "/oauth/authorize",
      token_endpoint: this.origin + "/oauth/token",
      registration_endpoint: this.origin + "/oauth/register",
      revocation_endpoint: this.origin + "/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: [
        "authorization_code",
        "refresh_token",
        "client_credentials",
      ],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["RS256"],
      scopes_supported: Object.keys(scopeActions),
      authorization_response_iss_parameter_supported: true,
    };
  }
  register(input) {
    if (
      !input ||
      !Array.isArray(input.redirect_uris) ||
      !input.redirect_uris.length ||
      input.redirect_uris.length > 10 ||
      input.redirect_uris.some((v) => typeof v !== "string") ||
      (input.token_endpoint_auth_method &&
        input.token_endpoint_auth_method !== "none") ||
      (input.grant_types &&
        (!Array.isArray(input.grant_types) ||
          input.grant_types.some(
            (v) => !["authorization_code", "refresh_token"].includes(v),
          ))) ||
      (input.response_types &&
        JSON.stringify(input.response_types) !== '["code"]')
    )
      invalid("invalid_client_metadata");
    const redirects = input.redirect_uris.map(redirectURI);
    const name = input.client_name || "MCP client";
    if (typeof name !== "string" || name.length > 200)
      invalid("invalid_client_metadata");
    // Unused public registrations expire. Active grants keep their client record.
    this.db
      .prepare(
        "DELETE FROM remote_clients WHERE created<? AND id NOT IN (SELECT client FROM remote_grants)",
      )
      .run(this.agents.now() - 86400000 * 30);
    if (
      Number(
        this.db.prepare("SELECT count(*) n FROM remote_clients").get().n,
      ) >= 10000
    )
      invalid("temporarily_unavailable", 429);
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO remote_clients VALUES (?,?,?,?)")
      .run(id, name, JSON.stringify(redirects), this.agents.now());
    return {
      client_id: id,
      client_name: name,
      redirect_uris: redirects,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }
  client(id) {
    if (typeof id !== "string") invalid("invalid_client");
    return (
      this.db.prepare("SELECT * FROM remote_clients WHERE id=?").get(id) ||
      invalid("invalid_client")
    );
  }
  request(params) {
    for (const key of params.keys())
      if (params.getAll(key).length !== 1) invalid();
    const client = this.client(params.get("client_id"));
    const redirect = params.get("redirect_uri");
    if (!JSON.parse(client.redirects).includes(redirect))
      invalid("invalid_redirect_uri");
    if (
      params.get("response_type") !== "code" ||
      params.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") || "") ||
      params.get("resource") !== this.resource
    )
      invalid();
    const scopes = (params.get("scope") || "wiki:read").split(" ");
    if (!scopes.length || scopes.some((s) => !Object.hasOwn(scopeActions, s)))
      invalid("invalid_scope");
    const state = params.get("state") || "";
    if (state.length > 2048) invalid();
    return {
      client: client.id,
      name: client.name,
      redirect,
      challenge: params.get("code_challenge"),
      scopes: [...new Set(scopes)],
      state,
    };
  }
  choices(actor) {
    return this.agents
      .list(actor)
      .filter(
        (a) =>
          a.active &&
          this.agents.allowed(actor, a.id, "invoke") &&
          this.control.role(a.id),
      );
  }
  consent(actor, params, csrf) {
    const request = this.request(params);
    const choices = this.choices(actor.id).map((a) => ({
      ...a,
      role: this.control.role(a.id),
    }));
    return shell(
      "Connect an agent",
      renderToStaticMarkup(
        createElement(AgentConsent, { actor, request, params, csrf, choices }),
      ),
    );
  }

  approve(actor, form) {
    // Approval parameters are validated again, including client and exact redirect.
    const params = new URLSearchParams(form);
    for (const k of ["agent", "csrf", "decision"]) params.delete(k);
    const request = this.request(params);
    const destination = new URL(request.redirect);
    if (request.state) destination.searchParams.set("state", request.state);
    destination.searchParams.set("iss", this.origin);
    if (form.get("decision") !== "allow") {
      destination.searchParams.set("error", "access_denied");
      return destination.href;
    }
    const agent = form.get("agent");
    this.agents.require(actor, agent, "invoke");
    const scopes = request.scopes.filter((s) =>
      this.agents.hasSpace(agent, "default", scopeActions[s]),
    );
    if (!scopes.includes("wiki:read")) invalid("invalid_scope");
    const code = secret();
    this.db
      .prepare("DELETE FROM remote_codes WHERE expires<=?")
      .run(this.agents.now());
    if (
      Number(this.db.prepare("SELECT count(*) n FROM remote_codes").get().n) >=
      10000
    )
      invalid("temporarily_unavailable", 429);
    this.db
      .prepare("INSERT INTO remote_codes VALUES (?,?,?,?,?)")
      .run(
        digest(code),
        actor,
        agent,
        JSON.stringify({ ...request, scopes }),
        this.agents.now() + 60000,
      );
    destination.searchParams.set("code", code);
    return destination.href;
  }
  validGrant(id) {
    const grant =
      this.db
        .prepare(
          "SELECT * FROM remote_grants WHERE id=? AND active=1 AND expires>?",
        )
        .get(id, this.agents.now()) || invalid("invalid_grant");
    this.agents.human(grant.principal);
    this.agents.require(grant.principal, grant.agent, "invoke");
    this.agents.run(grant.run);
    for (const s of JSON.parse(grant.scope))
      this.agents.authorize(grant.run, "default", scopeActions[s]);
    return grant;
  }
  issue(grant) {
    const access = secret(),
      refresh = secret(),
      now = this.agents.now();
    this.db.prepare("DELETE FROM remote_tokens WHERE expires<=?").run(now);
    this.db
      .prepare("INSERT INTO remote_tokens VALUES (?,?,?,?,?)")
      .run(
        digest(access),
        grant.id,
        "access",
        Math.min(now + 300000, grant.expires),
        0,
      );
    this.db
      .prepare("INSERT INTO remote_tokens VALUES (?,?,?,?,?)")
      .run(digest(refresh), grant.id, "refresh", grant.expires, 0);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: Math.min(300, Math.floor((grant.expires - now) / 1000)),
      scope: JSON.parse(grant.scope).join(" "),
    };
  }
  exchange(form) {
    this.client(form.get("client_id"));
    if (form.get("resource") && form.get("resource") !== this.resource)
      invalid("invalid_target");
    if (form.get("grant_type") === "authorization_code") {
      return this.control.transaction(() => {
        const row =
          this.db
            .prepare("SELECT * FROM remote_codes WHERE hash=? AND expires>?")
            .get(digest(form.get("code") || ""), this.agents.now()) ||
          invalid("invalid_grant");
        const request = JSON.parse(row.request);
        const verifier = form.get("code_verifier") || "";
        if (
          request.client !== form.get("client_id") ||
          request.redirect !== form.get("redirect_uri") ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
          createHash("sha256").update(verifier).digest("base64url") !==
            request.challenge
        )
          invalid("invalid_grant");
        this.db.prepare("DELETE FROM remote_codes WHERE hash=?").run(row.hash);
        if (
          Number(
            this.db
              .prepare(
                "SELECT count(*) n FROM remote_grants WHERE principal=? AND active=1 AND expires>?",
              )
              .get(row.principal, this.agents.now()).n,
          ) >= 100
        )
          invalid("temporarily_unavailable", 429);
        const expires = this.agents.now() + 30 * 86400000;
        const run = this.agents.startRecord(row.principal, row.agent, {
          mode: "independent",
          scope: [
            {
              space: "default",
              actions: request.scopes.map((s) => scopeActions[s]),
            },
          ],
          traceSpace: "default",
          expires,
        });
        const id = randomUUID();
        this.db
          .prepare("INSERT INTO remote_grants VALUES (?,?,?,?,?,?,?,1,?)")
          .run(
            id,
            request.client,
            row.principal,
            row.agent,
            run.id,
            JSON.stringify(request.scopes),
            expires,
            this.resource,
          );
        this.agents.record(row.principal, "agent:connect", id);
        return this.issue(this.validGrant(id));
      });
    }
    if (form.get("grant_type") !== "refresh_token")
      invalid("unsupported_grant_type");
    // Commit replay revocation even though the caller receives an error.
    const result = this.control.transaction(() => {
      const token =
        this.db
          .prepare(
            "SELECT * FROM remote_tokens WHERE hash=? AND kind='refresh' AND expires>?",
          )
          .get(digest(form.get("refresh_token") || ""), this.agents.now()) ||
        invalid("invalid_grant");
      const grant = this.validGrant(token.grant_id);
      if (grant.client !== form.get("client_id")) invalid("invalid_grant");
      if (token.used) {
        this.db
          .prepare("UPDATE remote_grants SET active=0 WHERE id=?")
          .run(grant.id);
        return null;
      }
      if (
        form.has("scope") &&
        form.get("scope") !== JSON.parse(grant.scope).join(" ")
      )
        invalid("invalid_scope");
      this.db
        .prepare("UPDATE remote_tokens SET used=1 WHERE hash=?")
        .run(token.hash);
      return this.issue(grant);
    });
    return result || invalid("invalid_grant");
  }
  revokeToken(form) {
    const row = this.db
      .prepare(
        "SELECT g.* FROM remote_tokens t JOIN remote_grants g ON g.id=t.grant_id WHERE t.hash=?",
      )
      .get(digest(form.get("token") || ""));
    if (row && row.client === form.get("client_id"))
      this.revoke(row.principal, row.id);
  }
  revoke(actor, id) {
    const row =
      this.db
        .prepare("SELECT * FROM remote_grants WHERE id=? AND principal=?")
        .get(id, actor) || invalid("access_denied", 403);
    this.db.prepare("UPDATE remote_grants SET active=0 WHERE id=?").run(row.id);
    this.agents.stop(actor, row.run);
  }
}
