// Synthetic loopback-only standards provider. Never use this with real content.
import http from "node:http";
import { once } from "node:events";
import Provider from "oidc-provider";
import { generateKeyPairSync } from "node:crypto";
export async function developmentIdentity(origin, port = 0) {
  const listener = http.createServer();
  listener.listen(port, "127.0.0.1");
  await once(listener, "listening");
  const issuer = `http://127.0.0.1:${listener.address().port}`;
  const users = {
    owner: "Example owner",
    reader: "Example reader",
    outsider: "Example visitor",
  };
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = privateKey.export({ format: "jwk" });
  Object.assign(jwk, { kid: "synthetic", use: "sig", alg: "RS256" });
  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: "example-wiki",
        client_secret: "synthetic-example-secret",
        redirect_uris: [origin + "/auth/callback"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
      },
    ],
    jwks: { keys: [jwk] },
    cookies: { keys: ["synthetic-cookie-signing-key-only"] },
    features: { devInteractions: { enabled: false } },
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
    claims: { openid: ["sub"], profile: ["name"] },
    findAccount: async (_ctx, id) =>
      users[id]
        ? { accountId: id, claims: async () => ({ sub: id, name: users[id] }) }
        : undefined,
  });
  const callback = provider.callback();
  listener.on("request", async (req, res) => {
    try {
      if (!req.url.startsWith("/interaction/")) return callback(req, res);
      const details = await provider.interactionDetails(req, res);
      if (details.prompt.name === "consent") {
        const grant = details.grantId
          ? await provider.Grant.find(details.grantId)
          : new provider.Grant({
              accountId: details.session.accountId,
              clientId: details.params.client_id,
            });
        if (details.prompt.details.missingOIDCScope)
          grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(" "));
        if (details.prompt.details.missingOIDCClaims)
          grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
        return await provider.interactionFinished(
          req,
          res,
          { consent: { grantId: await grant.save() } },
          { mergeWithLastSubmission: true },
        );
      }
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) throw Error("Too large");
        }
        const id = new URLSearchParams(body).get("user");
        if (!users[id]) throw Error("Unknown synthetic identity");
        return await provider.interactionFinished(
          req,
          res,
          { login: { accountId: id } },
          { mergeWithLastSubmission: false },
        );
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<h1>Synthetic example sign-in</h1><p>Local fictional identities only.</p><form method="post">${Object.entries(
          users,
        )
          .map(
            ([id, name]) =>
              `<button name="user" value="${id}">${name}</button>`,
          )
          .join(" ")}</form>`,
      );
    } catch {
      res.statusCode = 400;
      res.end("Example sign-in failed");
    }
  });
  return {
    issuer,
    clientId: "example-wiki",
    clientSecret: "synthetic-example-secret",
    close: () =>
      new Promise((resolve) => {
        listener.close(resolve);
        listener.closeAllConnections();
      }),
  };
}
