import { developmentIdentity } from "../../scripts/development-identity.mjs";
import { createOIDC } from "../../src/authn.mjs";
import { ControlStore } from "../../src/control-store.mjs";
import { hashPassword } from "../../src/passwords.mjs";
import { createWiki } from "../../src/server.mjs";
import { fixture } from "../helpers.mjs";
import { test, expect } from "@playwright/test";
import { once } from "node:events";
import path from "node:path";

let app, cleanup, base, control, identity;

test.beforeAll(async () => {
  const repo = fixture({ after: (fn) => (cleanup = fn) });
  const { default: net } = await import("node:net");
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  identity = await developmentIdentity(base);
  control = new ControlStore(path.join(repo, ".git", "control.sqlite3"));
  const owner = control.bootstrap({
    issuer: identity.issuer,
    subject: "owner",
    name: "Example owner",
  });
  const local = control.inviteLocal(
    owner,
    "recovery@example.invalid",
    "Recovery reader",
  );
  control.acceptInvitation(
    local.token,
    await hashPassword("a fictional recovery passphrase"),
  );
  control.grant(owner, local.id, "reader");
  const auth = await createOIDC({
    ...identity,
    origin: base,
    development: true,
  });
  app = createWiki({
    repo,
    origin: base,
    control,
    auth,
    autoLogin: true,
    localLogin: true,
    development: true,
  });
  app.listen(port, "127.0.0.1");
  await once(app, "listening");
});

test.afterAll(async () => {
  if (app)
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
  await identity?.close();
  control?.close();
  cleanup?.();
});

async function providerLogin(page, user = "Example owner", destination = "/") {
  await page.goto(
    base + "/auth/login?return_to=" + encodeURIComponent(destination),
  );
  await page.getByRole("button", { name: user, exact: true }).click();
}

test("automatic OIDC reuses the provider session for deep links and MCP consent", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await providerLogin(page);
  await expect(page).toHaveURL(base + "/");

  await context.clearCookies({ name: "wiki_session" });
  const destination = "/wiki/guide/?source=trace#original-section";
  await page.goto(base + destination);
  await expect(page).toHaveURL(base + destination);
  await expect(page.locator("article")).toBeVisible();

  const registration = await page.request.post(base + "/oauth/register", {
    data: {
      client_name: "Automatic login browser test",
      redirect_uris: ["http://127.0.0.1:18765/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(registration.status()).toBe(201);
  const client = await registration.json();
  await context.clearCookies({ name: "wiki_session" });
  const authorize = new URL(base + "/oauth/authorize");
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    state: "automatic-login",
    resource: base + "/mcp",
    scope: "wiki:read",
  });
  await page.goto(authorize.href);
  await expect(
    page.getByRole("heading", { name: "Choose an agent" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("state")).toBe("automatic-login");
  await context.close();
});

test("local recovery bypasses automatic OIDC and restores the destination", async ({
  page,
}) => {
  const destination = "/wiki/guide/?source=local#recovery";
  await page.goto(
    base +
      "/auth/sign-in?mode=local&return_to=" +
      encodeURIComponent(destination),
  );
  await expect(page.getByRole("link", { name: /Continue/ })).toHaveCount(0);
  await page
    .getByLabel("Email", { exact: true })
    .fill("recovery@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a fictional recovery passphrase");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(base + destination);
  await expect(page.locator("article")).toBeVisible();
});

test("logout pauses automatic OIDC until the person explicitly resumes", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await providerLogin(page);
  await page.goto(base + "/wiki/guide/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Continue to sign in" }),
  ).toBeVisible();

  await page.goto(base + "/wiki/guide/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(base + "/wiki/guide/");
  await expect(page.locator("article")).toBeVisible();
  await context.close();
});

test("callback denial pauses retries and an identity without a role does not loop", async ({
  browser,
}) => {
  const denied = await browser.newContext();
  const start = await denied.request.get(
    base + "/auth/login?return_to=" + encodeURIComponent("/wiki/guide/"),
    { maxRedirects: 0 },
  );
  expect(start.status()).toBe(303);
  const state = new URL(start.headers().location).searchParams.get("state");
  const deniedPage = await denied.newPage();
  const callback = await deniedPage.goto(
    base +
      "/auth/callback?error=access_denied&state=" +
      encodeURIComponent(state),
  );
  expect(callback.status()).toBe(400);
  await expect(deniedPage.getByRole("alert")).toContainText("cancelled");
  await deniedPage.goto(base + "/wiki/guide/");
  await expect(
    deniedPage.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await denied.close();

  const ungranted = await browser.newContext();
  const ungrantedPage = await ungranted.newPage();
  await providerLogin(ungrantedPage, "Example visitor", "/wiki/guide/");
  await expect(ungrantedPage).toHaveURL(base + "/");
  await expect(
    ungrantedPage.getByRole("heading", { name: "Your account is ready" }),
  ).toBeVisible();
  await ungrantedPage.reload();
  await expect(
    ungrantedPage.getByRole("heading", { name: "Your account is ready" }),
  ).toBeVisible();
  await ungranted.close();
});

test("an abandoned provider attempt waits for explicit restart", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const start = await context.request.get(
    base + "/auth/login?return_to=" + encodeURIComponent("/wiki/guide/"),
    { maxRedirects: 0 },
  );
  expect(start.status()).toBe(303);
  const page = await context.newPage();
  await page.goto(base + "/wiki/guide/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/wiki/guide/");
  await expect(page.locator("article")).toBeVisible();
  expect(control.db.prepare("SELECT count(*) n FROM logins").get().n).toBe(0);
  await context.close();
});

test("API, MCP, and health requests do not enter automatic OIDC", async ({
  request,
}) => {
  for (const route of ["/api/articles/catalog.json", "/mcp"]) {
    const response = await request.get(base + route, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).toContain("application/json");
    const html = await request.get(base + route, {
      headers: { Accept: "text/html" },
    });
    expect(html.status()).toBe(200);
    expect(await html.text()).not.toContain("data-auto-login-destination");
  }
  const health = await request.get(base + "/healthz", {
    headers: { Accept: "text/html" },
  });
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
});
