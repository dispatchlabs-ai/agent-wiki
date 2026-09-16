import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentCredential } from "./agent-client.mjs";
import { WikiError } from "./errors.mjs";

export function serviceOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WikiError("INVALID_URL", "Specify the wiki HTTPS origin");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new WikiError(
      "INVALID_URL",
      "Use HTTPS; HTTP is supported only for loopback development",
    );
  return url.origin;
}

export function readPrivateJSON(filename) {
  const stat = fs.lstatSync(filename);
  if (
    !stat.isFile() ||
    stat.mode & 0o077 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new WikiError(
      "UNSAFE_CREDENTIAL_FILE",
      "Credentials must be an owned regular file with mode 0600",
    );
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch {
    throw new WikiError(
      "INVALID_CREDENTIAL_FILE",
      "Credential file is invalid; restore it or log in using a new profile",
    );
  }
}

/** Atomic private profile writes; the command lock serializes rotating credentials. */
export function writeProfile(filename, value) {
  if (fs.existsSync(filename)) readPrivateJSON(filename);
  const temp = filename + "." + randomUUID();
  try {
    fs.writeFileSync(temp, JSON.stringify(value) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    const fd = fs.openSync(temp, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, filename);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export async function withProfile(filename, action) {
  filename = path.resolve(filename);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const lock = filename + ".lock";
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST")
      throw new WikiError(
        "CLIENT_BUSY",
        "Another command owns this profile. If it crashed, remove its .lock directory after confirming it has stopped.",
        409,
      );
    throw error;
  }
  try {
    return await action(filename);
  } finally {
    fs.rmdirSync(lock);
  }
}

export async function responseJSON(response) {
  let result;
  try {
    result = await response.json();
  } catch {
    throw new WikiError(
      "INVALID_RESPONSE",
      "The wiki returned an invalid JSON response",
      response.status,
    );
  }
  if (!response.ok)
    throw new WikiError(
      result.code || `HTTP_${response.status}`,
      result.error || "Wiki request failed",
      response.status,
    );
  return result;
}

/** Authenticated transport only: no Git, control database, or direct content access. */
export class WikiApiClient {
  constructor(
    profile,
    { fetch: fetchFn = globalThis.fetch, save = (value) => {} } = {},
  ) {
    this.profile = profile;
    this.origin = serviceOrigin(profile.origin);
    this.fetchFn = fetchFn;
    this.save = save;
    this.machine =
      profile.kind === "machine"
        ? new AgentCredential(readPrivateJSON(profile.connection))
        : null;
    if (this.machine && this.machine.origin !== this.origin)
      throw new WikiError(
        "INVALID_URL",
        "Connection origin changed; log in again",
      );
  }
  async fetch(route, init = {}) {
    const target = new URL(route, this.origin);
    if (
      target.origin !== this.origin ||
      target.username ||
      target.password ||
      target.hash
    )
      throw new WikiError(
        "INVALID_URL",
        "Requests must stay on the configured wiki origin",
      );
    return this.fetchFn(target, {
      ...init,
      redirect: "error",
      signal: init.signal || AbortSignal.timeout(30000),
    });
  }
  async token() {
    if (this.machine) return this.machine.token();
    const profile = this.profile;
    if (profile.kind !== "oauth")
      throw new WikiError("LOGIN_REQUIRED", "Run wiki login first", 401);
    if (profile.refreshPending)
      throw new WikiError(
        "LOGIN_REQUIRED",
        "A previous token refresh was interrupted. Log in again; do not reuse a possibly consumed refresh token.",
        401,
      );
    if (profile.expires > Date.now() + 30000)
      return profile.tokens.access_token;
    profile.refreshPending = true;
    this.save(profile);
    // Never automatically retry a rotating refresh token after an uncertain result.
    const tokens = await responseJSON(
      await this.fetch("/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: profile.client.client_id,
          refresh_token: profile.tokens.refresh_token,
          resource: this.origin + "/mcp",
        }),
      }),
    );
    profile.tokens = tokens;
    profile.expires = Date.now() + tokens.expires_in * 1000;
    profile.refreshPending = false;
    this.save(profile);
    return tokens.access_token;
  }
  async request(route, draft) {
    const headers = { Accept: "application/json" };
    if (this.profile.kind === "session") {
      headers["Cookie"] = `wiki_session=${this.profile.session}`;
      if (draft !== undefined) headers["X-Wiki-CSRF"] = this.profile.csrf;
    } else headers["Authorization"] = "Bearer " + (await this.token());
    if (draft !== undefined)
      Object.assign(headers, {
        "Content-Type": "application/json",
        "X-Wiki-Write": "1",
        Origin: this.origin,
      });
    return responseJSON(
      await this.fetch(route, {
        method: draft === undefined ? "GET" : "POST",
        headers,
        ...(draft === undefined ? {} : { body: JSON.stringify(draft) }),
      }),
    );
  }
  async logout() {
    if (this.profile.kind === "session") {
      try {
        return await this.request("/auth/logout", {});
      } catch (error) {
        if (error.status === 401)
          return { signedOut: true, sessionExpired: true };
        throw error;
      }
    }
    if (this.profile.kind === "oauth") {
      await responseJSON(
        await this.fetch("/oauth/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: this.profile.client.client_id,
            token: this.profile.tokens.refresh_token,
          }),
        }),
      );
    }
    return { signedOut: true };
  }
  async close() {
    await this.machine?.close();
  }
}

export async function localLogin(
  origin,
  email,
  password,
  fetchFn = globalThis.fetch,
) {
  const client = new WikiApiClient(
    { origin, kind: "session" },
    { fetch: fetchFn },
  );
  const form = await client.fetch("/", { headers: { Accept: "text/html" } });
  await form.text();
  const csrf = form.headers
    .getSetCookie()
    .map((c) => /^wiki_form=([^;]+)/.exec(c)?.[1])
    .find(Boolean);
  if (!csrf)
    throw new WikiError(
      "LOGIN_UNAVAILABLE",
      "Local password login is not available; use browser login",
      401,
    );
  const response = await client.fetch("/auth/local/login", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `wiki_form=${csrf}`,
      "X-Wiki-CSRF": csrf,
    },
    body: JSON.stringify({ email, password }),
  });
  await responseJSON(response);
  const session = response.headers
    .getSetCookie()
    .map((c) => /^wiki_session=([^;]+)/.exec(c)?.[1])
    .find(Boolean);
  if (!session)
    throw new WikiError(
      "INVALID_RESPONSE",
      "No login session was returned",
      401,
    );
  client.profile.session = session;
  const me = await client.request("/api/me");
  return { version: 1, kind: "session", origin, session, csrf: me.csrf };
}
