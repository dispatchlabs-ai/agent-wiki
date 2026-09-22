import * as oidc from "openid-client";
export const GOOGLE_ISSUER = "https://accounts.google.com";
export function cookieValue(req, name) {
  const parts = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + "="));
  return parts.length === 1 ? parts[0].slice(name.length + 1) : null;
}
export function cookie(name, value, origin, maxAge = 28800) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(origin).protocol === "https:" ? "; Secure" : ""}`;
}
export async function createOIDC({
  issuer,
  clientId,
  clientSecret,
  hd,
  origin,
  development = false,
  label = issuer === GOOGLE_ISSUER
    ? "Continue with Google"
    : "Continue to sign in",
}) {
  const local = (url) =>
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  if (new URL(origin).protocol !== "https:" && !(development && local(origin)))
    throw Error("HTTPS origin required");
  if (new URL(issuer).protocol !== "https:" && !(development && local(issuer)))
    throw Error("HTTPS issuer required");
  const config = await oidc.discovery(
    new URL(issuer),
    clientId,
    clientSecret,
    undefined,
    development ? { execute: [oidc.allowInsecureRequests] } : undefined,
  );
  const callback = new URL("/auth/callback", origin).href;
  return {
    issuer,
    label,
    async begin(login) {
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: callback,
        scope: "openid profile email",
        state: login.state,
        nonce: login.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(login.verifier),
        code_challenge_method: "S256",
        ...(hd ? { hd } : {}),
      }).href;
    },
    async finish(url, login) {
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: login.verifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub || claims.iss !== issuer)
        throw Error("Invalid identity");
      if (
        hd &&
        (typeof claims.email !== "string" ||
          !claims.email ||
          claims.email_verified !== true ||
          claims.hd !== hd)
      )
        throw Error("Invalid workspace identity");
      const profile = await oidc.fetchUserInfo(
        config,
        tokens.access_token,
        claims.sub,
      );
      return {
        issuer,
        subject: claims.sub,
        name:
          profile.name ||
          profile.preferred_username ||
          claims.name ||
          "Wiki reader",
      };
    },
  };
}

// The Google preset is direct OIDC. A hosted-domain boundary is optional and
// explicit; no group or role is ever inferred from Google claims.
export function oidcSettings(env) {
  if (
    env.WIKI_GOOGLE_CLIENT_ID ||
    env.WIKI_GOOGLE_CLIENT_SECRET ||
    env.WIKI_GOOGLE_WORKSPACE_DOMAIN
  ) {
    if (
      !env.WIKI_GOOGLE_CLIENT_ID ||
      !env.WIKI_GOOGLE_CLIENT_SECRET ||
      env.WIKI_OIDC_ISSUER ||
      env.WIKI_OIDC_CLIENT_ID ||
      env.WIKI_OIDC_CLIENT_SECRET
    )
      throw Error("Set both Google client values and omit generic OIDC values");
    if (
      env.WIKI_GOOGLE_WORKSPACE_DOMAIN &&
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        env.WIKI_GOOGLE_WORKSPACE_DOMAIN,
      )
    )
      throw Error("Google Workspace domain must be a lowercase DNS name");
    return {
      issuer: GOOGLE_ISSUER,
      clientId: env.WIKI_GOOGLE_CLIENT_ID,
      clientSecret: env.WIKI_GOOGLE_CLIENT_SECRET,
      ...(env.WIKI_GOOGLE_WORKSPACE_DOMAIN
        ? { hd: env.WIKI_GOOGLE_WORKSPACE_DOMAIN }
        : {}),
    };
  }
  if (
    env.WIKI_OIDC_ISSUER ||
    env.WIKI_OIDC_CLIENT_ID ||
    env.WIKI_OIDC_CLIENT_SECRET
  ) {
    if (
      !env.WIKI_OIDC_ISSUER ||
      !env.WIKI_OIDC_CLIENT_ID ||
      !env.WIKI_OIDC_CLIENT_SECRET
    )
      throw Error("Complete OIDC configuration is required");
    return {
      issuer: env.WIKI_OIDC_ISSUER,
      clientId: env.WIKI_OIDC_CLIENT_ID,
      clientSecret: env.WIKI_OIDC_CLIENT_SECRET,
    };
  }
  return null;
}

// Discover only when used, allowing local accounts to sign in during an IdP outage.
export function configuredOIDC(settings, origin) {
  let pending;
  const get = () =>
    (pending ||= createOIDC({ ...settings, origin }).catch((error) => {
      pending = null;
      throw error;
    }));
  return {
    issuer: settings.issuer,
    label:
      settings.issuer === GOOGLE_ISSUER
        ? "Continue with Google"
        : "Continue to sign in",
    begin: async (login) => (await get()).begin(login),
    finish: async (url, login) => (await get()).finish(url, login),
  };
}

// Only same-site paths can survive a login round trip. Never redirect to a
// caller-controlled origin, protocol-relative URL, or another login endpoint.
export function returnPath(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20\x7f]/.test(value)
  )
    return "/";
  try {
    const base = "https://wiki.invalid";
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname.startsWith("/auth/")) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
