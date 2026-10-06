import { test, expect } from "@playwright/test";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { fixture } from "../helpers.mjs";
import { ControlStore } from "../../src/control-store.mjs";
import { createWiki } from "../../src/server.mjs";
import { hashPassword } from "../../src/passwords.mjs";
import { developmentIdentity } from "../../scripts/development-identity.mjs";
import { createOIDC } from "../../src/authn.mjs";

const password = "Synthetic account passphrase for browser MFA";
let app, control, cleanup, origin, provider;
test.beforeEach(async () => {
  const repo = fixture({
    after: (fn) => {
      cleanup = fn;
    },
  });
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  origin = `http://localhost:${port}`;
  control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  provider = await developmentIdentity(origin);
  const owner = control.bootstrap({
    issuer: provider.issuer,
    subject: "owner",
    name: "Example owner",
  });
  const local = control.inviteLocal(
    owner,
    "local@example.test",
    "Local example",
  );
  control.acceptInvitation(local.token, await hashPassword(password));
  control.grant(owner, local.id, "reader");
  const auth = await createOIDC({ ...provider, origin, development: true });
  app = createWiki({
    repo,
    control,
    origin,
    auth,
    localLogin: true,
    development: true,
  });
  app.listen(port, "127.0.0.1");
  await once(app, "listening");
});
test.afterEach(async () => {
  if (app)
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
  await provider?.close();
  control?.close();
  cleanup?.();
});
async function local(page) {
  await page.goto(
    origin + "/auth/sign-in?mode=local&return_to=%2Fwiki%2Fguide%2F",
  );
  await page.getByLabel("Email", { exact: true }).fill("local@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function layouts(page, name) {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name} ${width} ${theme}`,
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`${name}-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
}
async function enrollTotp(page) {
  await page.goto(origin + "/account/security/");
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  await expect(page.getByLabel("Or enter this setup key")).not.toHaveValue("");
  const secret = await page.getByLabel("Or enter this setup key").inputValue();
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  await expect(page.locator("#mfa-qr")).toBeVisible();
  await page
    .getByLabel("Authenticator code", { exact: true })
    .fill(totp.generate());
  await page.getByRole("button", { name: "Verify and enable" }).click();
  await expect(
    page.getByLabel("Recovery codes", { exact: true }),
  ).toBeVisible();
  const codes = (
    await page.getByLabel("Recovery codes", { exact: true }).inputValue()
  ).split("\n");
  expect(codes).toHaveLength(10);
  return { totp, codes };
}
test("local account enrolls TOTP, signs in with a second factor, uses recovery, and can turn protection off", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await local(page);
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  const { totp, codes } = await enrollTotp(page);
  await layouts(page, "recovery-codes");
  await page.getByRole("link", { name: "I saved my codes" }).click();
  await expect(
    page.getByText("Two-factor authentication is on.", { exact: false }),
  ).toBeVisible();
  await local(page);
  await expect(page).toHaveURL(origin + "/auth/mfa");
  expect((await page.request.get(origin + "/api/me")).status()).toBe(401);
  await layouts(page, "totp-challenge");
  await page
    .getByLabel("Authenticator code", { exact: true })
    .fill(totp.generate({ timestamp: Date.now() + 30000 }));
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  await local(page);
  await expect(page).toHaveURL(origin + "/auth/mfa");
  await page.getByText("Use a recovery code", { exact: true }).click();
  await page.getByLabel("Recovery code", { exact: true }).fill(codes[0]);
  await page
    .getByRole("button", { name: "Use recovery code", exact: true })
    .click();
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  await page.goto(origin + "/account/security/");
  await layouts(page, "security-settings");
  await page
    .getByText("Turn off two-factor authentication", { exact: true })
    .first()
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Turn off two-factor authentication",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Two-factor authentication is off.", { exact: false }),
  ).toBeVisible();
  await local(page);
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  expect(errors).toEqual([]);
});
test("a user-verified virtual passkey enrolls and completes a separate second-factor challenge", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await local(page);
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  await page.goto(origin + "/account/security/");
  await page
    .getByLabel("Passkey name", { exact: true })
    .fill("Synthetic platform passkey");
  await page
    .getByRole("button", { name: "Add a passkey", exact: true })
    .click();
  await expect(
    page.getByLabel("Recovery codes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "I saved my codes" }).click();
  await expect(
    page.getByText("Synthetic platform passkey", { exact: true }),
  ).toBeVisible();
  await local(page);
  await expect(page).toHaveURL(origin + "/auth/mfa");
  expect((await page.request.get(origin + "/api/me")).status()).toBe(401);
  await layouts(page, "passkey-challenge");
  await page
    .getByRole("button", { name: "Use a passkey", exact: true })
    .click();
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  expect(errors).toEqual([]);
});
test("OIDC sign-in also requires the account's enrolled factor and retains its article destination", async ({
  page,
}) => {
  const oidc = async () => {
    await page.goto(origin + "/auth/login?return_to=%2Fwiki%2Fguide%2F");
    await page
      .getByRole("button", { name: "Example owner", exact: true })
      .click();
  };
  await oidc();
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  const { codes } = await enrollTotp(page);
  // The provider retains its own authenticated session and returns directly.
  await page.goto(origin + "/auth/login?return_to=%2Fwiki%2Fguide%2F");
  await expect(page).toHaveURL(origin + "/auth/mfa");
  expect((await page.request.get(origin + "/api/me")).status()).toBe(401);
  await page.getByText("Use a recovery code", { exact: true }).click();
  await page.getByLabel("Recovery code", { exact: true }).fill(codes[0]);
  await page
    .getByRole("button", { name: "Use recovery code", exact: true })
    .click();
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  expect((await (await page.request.get(origin + "/api/me")).json()).role).toBe(
    "manager",
  );
});
