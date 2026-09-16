import http from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { auth } from "@modelcontextprotocol/client";
import { WikiApiClient } from "./api-client.mjs";
import { WikiError } from "./errors.mjs";

/** Standard SDK PKCE + state/issuer validation. Tokens never go to stdout. */
export async function browserLogin(
  origin,
  scope,
  showURL,
  { timeout = 300000 } = {},
) {
  const profile = {
    version: 1,
    kind: "oauth",
    origin,
    client: undefined,
    tokens: undefined,
    expires: 0,
  };
  const client = new WikiApiClient(profile);
  const state = randomBytes(32).toString("base64url");
  let finish;
  const callback = new Promise((resolve) => {
    finish = resolve;
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (
      req.method !== "GET" ||
      req.headers.host !== new URL(profile.redirect).host ||
      url.pathname !== "/callback" ||
      url.searchParams.get("state") !== state
    ) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid login callback");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    res.end("Return to the terminal to check login completion.");
    finish(url);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  profile.redirect = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/callback`;
  let verifier, discovery;
  const provider = {
    redirectUrl: profile.redirect,
    clientMetadata: {
      client_name: "Agent Wiki CLI",
      redirect_uris: [profile.redirect],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    state: () => state,
    clientInformation: () => profile.client,
    saveClientInformation: (value) => {
      profile.client = value;
    },
    tokens: () => profile.tokens,
    saveTokens: (value) => {
      profile.tokens = value;
      profile.expires = Date.now() + value.expires_in * 1000;
    },
    redirectToAuthorization: showURL,
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    saveDiscoveryState: (value) => {
      discovery = value;
    },
    discoveryState: () => discovery,
  };
  const fetchFn = (input, init) =>
    client.fetch(input instanceof Request ? input.url : String(input), init);
  let timer;
  try {
    await auth(provider, { serverUrl: origin + "/mcp", scope, fetchFn });
    const result = await Promise.race([
      callback,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new WikiError("LOGIN_TIMEOUT", "Browser login timed out", 401),
            ),
          timeout,
        );
      }),
    ]);
    if (result.searchParams.get("error") || !result.searchParams.get("code"))
      throw new WikiError(
        "LOGIN_DENIED",
        "Browser authorization was denied",
        401,
      );
    await auth(provider, {
      serverUrl: origin + "/mcp",
      authorizationCode: result.searchParams.get("code"),
      iss: result.searchParams.get("iss"),
      scope,
      fetchFn,
    });
    return profile;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
