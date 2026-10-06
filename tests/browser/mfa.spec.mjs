import { test, expect } from "@playwright/test";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
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
  await page.getByText("View recovery codes", { exact: true }).click();
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
  await page.getByRole("link", { name: "Back to security" }).click();
  await expect(page.getByText("Enabled", { exact: true })).toBeVisible();
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
  await expect(page.getByText("Not enabled", { exact: true })).toBeVisible();
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
  const virtualOptions = {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  };
  const firstAuthenticator = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    { options: virtualOptions },
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await local(page);
  await expect(page).toHaveURL(origin + "/wiki/guide/");
  await page.goto(origin + "/account/security/");
  await expect(page.getByLabel("Passkey name", { exact: true })).toHaveCount(0);
  await layouts(page, "choose-method");
  await page
    .getByRole("button", { name: "Add a passkey", exact: true })
    .click();
  await page.getByText("View recovery codes", { exact: true }).click();
  await expect(
    page.getByLabel("Recovery codes", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Passkey added", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Passkey 1", { exact: true })).toBeVisible();
  await page.getByText("View recovery codes", { exact: true }).click();
  await layouts(page, "passkey-added");
  const codes = await page
    .getByLabel("Recovery codes", { exact: true })
    .inputValue();
  const cookies = await context.cookies();
  const current = await (
    await page.request.get(origin + "/api/account/security")
  ).json();
  const rejected = await page.request.post(origin + "/api/account/security", {
    headers: { Origin: origin, "X-Wiki-CSRF": "wrong" },
    data: { action: "rename", factor: current.factors[0].id, name: "Rejected" },
  });
  expect(rejected.status()).toBe(403);
  expect(
    (await (await page.request.get(origin + "/api/account/security")).json())
      .factors[0].name,
  ).toBe("Passkey 1");
  await page
    .getByRole("button", { name: "Rename Passkey 1", exact: true })
    .click();
  await page
    .getByLabel("Passkey name", { exact: true })
    .fill("Synthetic platform passkey");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Rename Synthetic platform passkey",
      exact: true,
    }),
  ).toBeVisible();
  expect(await context.cookies()).toEqual(cookies);
  await expect(page.getByLabel("Recovery codes", { exact: true })).toHaveValue(
    codes,
  );
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save recovery codes", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("agent-wiki-recovery-codes.txt");
  expect(fs.readFileSync(await download.path(), "utf8")).toContain(codes);
  await page.getByRole("link", { name: "Back to security" }).click();
  await expect(
    page.getByText("Synthetic platform passkey", { exact: true }),
  ).toBeVisible();
  await cdp.send("WebAuthn.removeVirtualAuthenticator", firstAuthenticator);
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: virtualOptions,
  });
  // Default labels are allocated against current names at enrollment completion.
  await page
    .getByRole("button", {
      name: "Rename Synthetic platform passkey",
      exact: true,
    })
    .click();
  await page.getByLabel("Passkey name", { exact: true }).fill("Passkey 1");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Rename Passkey 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add a passkey", exact: true })
    .click();
  await expect(page.getByText("Passkey 2", { exact: true })).toBeVisible();
  await expect(page.locator("#mfa-recovery-result")).toBeHidden();

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
