import fs from "node:fs";
import path from "node:path";
import {
  auth,
  PrivateKeyJwtProvider,
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

/** Runtime-owned credentials. Neither the signing key nor tokens are MCP results. */
export class AgentCredential {
  constructor(
    config,
    {
      fetch: fetchFn = globalThis.fetch,
      now = () => Date.now(),
      runLifetimeSeconds = 86400,
    } = {},
  ) {
    const url = new URL(config.endpoint);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/mcp"
    )
      throw Error(
        "Configure an HTTPS wiki /mcp endpoint (HTTP is only for loopback development)",
      );
    if (
      config.version !== 1 ||
      typeof config.agent !== "string" ||
      typeof config.key !== "string" ||
      !!config.privateKeyFile === !!config.privateKeyEnv
    )
      throw Error("Invalid agent connection file");
    if (
      !Number.isSafeInteger(runLifetimeSeconds) ||
      runLifetimeSeconds < 60 ||
      runLifetimeSeconds > 86400
    )
      throw Error("Invalid run lifetime");
    this.runLifetimeSeconds = runLifetimeSeconds;
    this.config = config;
    this.origin = url.origin;
    this.now = now;
    this.run = null;
    this.accessToken = null;
    this.expires = 0;
    this.pending = null;
    this.closed = false;
    if (config.privateKeyFile) {
      if (!path.isAbsolute(config.privateKeyFile))
        throw Error("privateKeyFile must be absolute");
      const stat = fs.lstatSync(config.privateKeyFile);
      if (
        !stat.isFile() ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw Error("Private key must be an owned regular file with mode 0600");
      this.privateKey = fs.readFileSync(config.privateKeyFile, "utf8");
    } else {
      this.privateKey = process.env[config.privateKeyEnv];
      if (!this.privateKey)
        throw Error("Private key environment variable is unavailable");
    }
    this.fetch = async (input, init = {}) => {
      const target = new URL(
        input instanceof Request ? input.url : String(input),
      );
      if (
        target.origin !== this.origin ||
        target.username ||
        target.password ||
        ![
          "/mcp",
          "/api/agent/run",
          "/oauth/token",
          "/.well-known/oauth-protected-resource/mcp",
          "/.well-known/oauth-protected-resource",
          "/.well-known/oauth-authorization-server",
        ].includes(target.pathname)
      )
        throw Error("Wiki credential destination rejected");
      const response = await fetchFn(input, {
        ...init,
        redirect: "error",
        signal: init.signal || AbortSignal.timeout(30000),
      });
      if (target.pathname === "/oauth/token" && response.ok) {
        const result = await response.clone().json();
        if (
          typeof result.wiki_run !== "string" ||
          (this.run && result.wiki_run !== this.run)
        )
          throw Error("Wiki token changed run identity");
        this.run = result.wiki_run;
      }
      return response;
    };
  }
  async token() {
    if (this.closed) throw Error("Agent connection is closed");
    if (this.accessToken && this.expires > this.now() + 30000)
      return this.accessToken;
    if (!this.pending)
      this.pending = this.renew().finally(() => {
        this.pending = null;
      });
    await this.pending;
    return this.accessToken;
  }
  async renew() {
    const provider = new PrivateKeyJwtProvider({
      clientId: this.config.agent,
      privateKey: this.privateKey,
      algorithm: "RS256",
      expectedIssuer: this.origin,
      jwtLifetimeSeconds: 60,
      scope: this.config.scope || "wiki:read wiki:trace",
      claims: {
        wiki_key: this.config.key,
        wiki_run_duration: this.runLifetimeSeconds,
        ...(this.run ? { wiki_run: this.run } : {}),
      },
    });
    try {
      await auth(provider, {
        serverUrl: new URL(this.config.endpoint),
        scope: this.config.scope || "wiki:read wiki:trace",
        fetchFn: this.fetch,
      });
      const tokens = provider.tokens();
      if (
        !this.run ||
        !tokens?.access_token ||
        !Number.isFinite(tokens.expires_in) ||
        tokens.expires_in <= 0 ||
        tokens.token_type.toLowerCase() !== "bearer"
      )
        throw Error("Invalid token response");
      this.accessToken = tokens.access_token;
      this.expires = this.now() + tokens.expires_in * 1000;
    } catch {
      this.accessToken = null;
      throw Error(
        "Wiki agent authentication failed. Check registration, key expiry, permissions, and run status.",
      );
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.accessToken) {
      try {
        await this.fetch(this.origin + "/api/agent/run", {
          method: "DELETE",
          headers: { Authorization: "Bearer " + this.accessToken },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        /* Expiry or revocation already stops this run's access. */
      }
    }
    this.privateKey = null;
    this.accessToken = null;
  }
}

export async function connectAgent(config, options = {}) {
  const credential = new AgentCredential(config, options);
  const client = new Client({ name: "agent-wiki-adapter", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(config.endpoint),
    {
      authProvider: {
        token: () => credential.token(),
        onUnauthorized: async () => {
          credential.expires = 0;
          await credential.token();
        },
      },
      fetch: credential.fetch,
    },
  );
  try {
    await client.connect(transport);
  } catch (error) {
    await credential.close();
    await client.close().catch(() => {});
    throw error;
  }
  return {
    client,
    credential,
    close: async () => {
      await client.close();
      await credential.close();
    },
  };
}
