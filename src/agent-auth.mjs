import { decodeJwt, importJWK, jwtVerify } from "jose";
import { WikiError } from "./errors.mjs";

const assertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const scopes = new Map([
  ["wiki:read", "read"],
  ["wiki:write", "write"],
  ["wiki:trace", "trace"],
]);
const denied = () =>
  new WikiError("INVALID_TOKEN", "Invalid agent credential", 401);

/** Narrow machine-to-machine OAuth endpoint, with pinned registered public keys. */
export class AgentAuth {
  constructor(agents, origin) {
    this.agents = agents;
    this.origin = origin;
    this.resource = origin + "/mcp";
  }
  challenge() {
    return `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource/mcp"`;
  }
  metadata(path) {
    if (
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ].includes(path)
    )
      return {
        resource: this.resource,
        authorization_servers: [this.origin],
        scopes_supported: [...scopes.keys()],
        bearer_methods_supported: ["header"],
      };
    if (path === "/.well-known/oauth-authorization-server")
      return {
        issuer: this.origin,
        token_endpoint: this.origin + "/oauth/token",
        authorization_endpoint: this.origin + "/oauth/authorize",
        response_types_supported: [],
        grant_types_supported: ["client_credentials"],
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["RS256"],
        scopes_supported: [...scopes.keys()],
      };
    return null;
  }
  async token(req, suppliedForm = null) {
    if (
      req.headers["content-type"]?.split(";")[0] !==
      "application/x-www-form-urlencoded"
    )
      throw new WikiError("INVALID_REQUEST", "Form encoding required", 400);
    if (
      (req.headers.origin !== undefined &&
        req.headers.origin !== this.origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw new WikiError("INVALID_REQUEST", "Invalid origin", 403);
    this.agents.control.limitLogin(
      "agent-source:" + req.socket.remoteAddress,
      1000,
    );
    const chunks = [];
    let size = 0;
    for await (const chunk of suppliedForm ? [] : req) {
      size += chunk.length;
      if (size > 16384)
        throw new WikiError("INVALID_REQUEST", "Request too large", 413);
      chunks.push(chunk);
    }
    const form =
      suppliedForm ||
      new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    for (const key of form.keys())
      if (form.getAll(key).length !== 1)
        throw new WikiError("INVALID_REQUEST", "Duplicate parameter", 400);
    if (
      form.get("grant_type") !== "client_credentials" ||
      form.get("client_assertion_type") !== assertionType ||
      form.get("resource") !== this.resource
    )
      throw new WikiError("INVALID_REQUEST", "Invalid grant or resource", 400);
    let entries = null;
    if (form.has("scope")) {
      const names = form.get("scope").split(" ");
      if (!names.length || names.some((name) => !scopes.has(name)))
        throw new WikiError("INVALID_SCOPE", "Invalid scope", 400);
      entries = [
        { space: "default", actions: names.map((name) => scopes.get(name)) },
      ];
    }
    try {
      const assertion = form.get("client_assertion");
      if (!assertion || assertion.length > 12000) throw denied();
      // Decoded values select a previously registered key; they grant no authority.
      const hint = decodeJwt(assertion);
      const agent = form.get("client_id") || hint.iss;
      if (
        typeof agent !== "string" ||
        !agent ||
        agent.length > 200 ||
        hint.iss !== agent ||
        hint.sub !== agent ||
        typeof hint.wiki_key !== "string" ||
        hint.wiki_key.length > 100
      )
        throw denied();
      const key = await importJWK(
        this.agents.key(agent, hint.wiki_key),
        "RS256",
      );
      const { payload, protectedHeader } = await jwtVerify(assertion, key, {
        issuer: agent,
        audience: this.origin,
        algorithms: ["RS256"],
        requiredClaims: ["iss", "sub", "aud", "iat", "exp", "jti", "wiki_key"],
        currentDate: new Date(this.agents.now()),
        clockTolerance: 0,
      });
      const now = Math.floor(this.agents.now() / 1000);
      if (
        payload.sub !== agent ||
        !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) ||
        payload.iat > now ||
        payload.iat < now - 60 ||
        payload.exp > payload.iat + 60 ||
        typeof payload.jti !== "string" ||
        payload.jti.length > 200 ||
        (protectedHeader.kid && protectedHeader.kid !== payload.wiki_key) ||
        (payload.wiki_run !== undefined && typeof payload.wiki_run !== "string")
      )
        throw denied();
      return this.agents.issue(
        agent,
        payload.wiki_key,
        payload.wiki_run,
        this.resource,
        entries,
        payload.jti,
        payload.exp * 1000,
        payload.agent_house_proof,
      );
    } catch (error) {
      if (error instanceof WikiError && error.status === 429) throw error;
      throw denied();
    }
  }
  bearer(header, closing = false) {
    if (
      typeof header !== "string" ||
      !/^Bearer [A-Za-z0-9_-]{43}$/i.test(header)
    )
      throw denied();
    const token = header.slice(7);
    try {
      return {
        token,
        actor: this.agents.authenticate(token, this.resource, closing),
      };
    } catch {
      throw denied();
    }
  }
  /** Only supported machine APIs accept agent tokens, never account controls. */
  action(path) {
    if (["/mcp", "/mcp/", "/api/agent/run"].includes(path)) return null;
    if (path === "/api/articles/edits") return "write";
    if (path.startsWith("/api/articles/")) return "read";
    if (path.startsWith("/api/traces/") || path.startsWith("/api/evidence/v1/"))
      return "trace";
    throw new WikiError("NOT_FOUND", "Not found", 404);
  }
  require(token, action, closing = false) {
    return action
      ? this.agents.requireToken(token, this.resource, "default", action)
      : this.agents.authenticate(token, this.resource, closing);
  }
}
