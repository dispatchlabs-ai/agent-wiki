import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import { cookie, createOIDC } from "../src/authn.mjs";

test("browser cookies retain the required session protections", () => {
  assert.equal(
    cookie("wiki_oidc_auto", "paused", "https://wiki.example", 31536000),
    "wiki_oidc_auto=paused; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure",
  );
});

test("OIDC rejects wrong issuer, audience, expiry, nonce, and callback state", async (t) => {
  // A synthetic token endpoint isolates malformed claims. Browser tests separately
  // exercise authorization/code exchange against a standards provider.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const key = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  let origin,
    override = {};
  const app = http.createServer((req, res) => {
    let body;
    if (req.url === "/.well-known/openid-configuration")
      body = {
        issuer: origin,
        authorization_endpoint: origin + "/authorize",
        token_endpoint: origin + "/token",
        userinfo_endpoint: origin + "/userinfo",
        jwks_uri: origin + "/jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      };
    else if (req.url === "/jwks") body = { keys: [key] };
    else if (req.url === "/userinfo") body = { sub: "owner", name: "Owner" };
    else {
      const encode = (v) =>
        Buffer.from(JSON.stringify(v)).toString("base64url");
      const claims = {
        iss: origin,
        sub: "owner",
        aud: "wiki",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        nonce: "nonce",
        ...override,
      };
      const input =
        encode({ alg: "RS256", kid: "test" }) + "." + encode(claims);
      body = {
        access_token: "synthetic-token",
        token_type: "Bearer",
        id_token:
          input +
          "." +
          sign("RSA-SHA256", Buffer.from(input), privateKey).toString(
            "base64url",
          ),
      };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  origin = `http://127.0.0.1:${app.address().port}`;
  t.after(
    () =>
      new Promise((resolve) => {
        app.close(resolve);
        app.closeAllConnections();
      }),
  );
  const auth = await createOIDC({
    issuer: origin,
    clientId: "wiki",
    clientSecret: "synthetic-secret",
    origin,
    development: true,
  });
  const callback = new URL("/auth/callback?code=synthetic&state=state", origin);
  const login = { state: "state", nonce: "nonce", verifier: "x".repeat(43) };
  assert.equal((await auth.finish(callback, login)).subject, "owner");
  for (const claims of [
    { iss: "https://wrong.example" },
    { aud: "other-client" },
    { exp: 1 },
    { nonce: "wrong" },
  ]) {
    override = claims;
    await assert.rejects(() => auth.finish(callback, login));
  }
  override = {};
  await assert.rejects(() =>
    auth.finish(
      new URL("/auth/callback?code=synthetic&state=forged", origin),
      login,
    ),
  );

  const workspace = await createOIDC({
    issuer: origin,
    clientId: "wiki",
    clientSecret: "synthetic-secret",
    hd: "example.com",
    origin,
    development: true,
  });
  assert.equal(
    new URL(await workspace.begin(login)).searchParams.get("hd"),
    "example.com",
  );
  override = {
    email: "owner@example.com",
    email_verified: true,
    hd: "example.com",
  };
  assert.equal((await workspace.finish(callback, login)).subject, "owner");
  for (const claims of [
    {
      email: "owner@example.com",
      email_verified: false,
      hd: "example.com",
    },
    {
      email: "owner@example.com",
      email_verified: true,
      hd: "other.example",
    },
    { email: "owner@example.com", email_verified: true },
    { email_verified: true, hd: "example.com" },
  ]) {
    override = claims;
    await assert.rejects(() => workspace.finish(callback, login));
  }
});

test("login destinations preserve local deep links and reject open redirects", async () => {
  const { returnPath } = await import("../src/authn.mjs");
  assert.equal(
    returnPath("/wiki/guide/?view=source#section-detail"),
    "/wiki/guide/?view=source#section-detail",
  );
  for (const value of [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/auth/login",
    "/a\nLocation: evil",
    null,
  ])
    assert.equal(returnPath(value), "/");
});
