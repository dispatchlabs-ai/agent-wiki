import { developmentIdentity } from "../../scripts/development-identity.mjs";
import { createOIDC } from "../../src/authn.mjs";
import { ControlStore } from "../../src/control-store.mjs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createWiki } from "../../src/server.mjs";
import { fixture } from "../helpers.mjs";
let app, cleanup, base, control, identity;
test.beforeAll(async () => {
  const repo = fixture({
    after: (fn) => {
      cleanup = fn;
    },
  });
  // Reserve an ephemeral listener before constructing the origin-checked handler.
  const { default: net } = await import("node:net");
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  control = new ControlStore(path.join(repo, ".git", "control.sqlite3"));
  identity = await developmentIdentity(base);
  control.bootstrap({
    issuer: identity.issuer,
    subject: "owner",
    name: "Example owner",
  });
  const auth = await createOIDC({
    ...identity,
    origin: base,
    development: true,
  });
  app = createWiki({
    repo,
    origin: base,
    write: true,
    control,
    auth,
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
test("browser loads modules, saves and repeats an unchanged edit", async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/wiki/guide/edit/");
  await expect(
    page.getByRole("button", { name: "Save revision" }),
  ).toBeEnabled();
  await page
    .getByLabel("Markdown", { exact: true })
    .fill("Browser-tested explanation.");
  await page.getByLabel("Change summary").fill("Explain the browser check");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByRole("status")).toContainText("Saved in Git");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("button", { name: "Save revision" }),
  ).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Saved in Git");
  await page.goto(base + "/wiki/guide/");
  await expect(page.locator("article")).toHaveText(
    "Browser-tested explanation.",
  );
  await expect(page.locator(".meta")).toContainText("Revision 2");
  expect(errors).toEqual([]);
});

test("OIDC visitor has no access until a manager grants it, and logout ends session", async ({
  browser,
  page,
}) => {
  const visitor = await browser.newContext();
  const other = await visitor.newPage();
  await other.goto(base + "/auth/login");
  await other
    .getByRole("button", { name: "Example visitor", exact: true })
    .click();
  await expect(other).toHaveURL(base + "/");
  expect(
    (await visitor.request.get(base + "/api/articles/catalog.json")).status(),
  ).toBe(404);
  await page.goto(base + "/auth/login");
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/");
  await page.goto(base + "/access/");
  await page.getByLabel("Example visitor access").selectOption("reader");
  const row = page
    .locator("form")
    .filter({ has: page.getByLabel("Example visitor access") });
  await row.getByRole("button", { name: "Save access" }).click();
  await expect(row.getByRole("status")).toHaveText("Saved");
  await other.goto(base + "/wiki/guide/");
  await expect(other.locator("article")).toBeVisible();
  await other.getByRole("button", { name: "Account menu" }).click();
  await other.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(
    other.getByRole("link", { name: "Continue to sign in" }),
  ).toBeVisible();
  expect(
    (await visitor.request.get(base + "/api/articles/catalog.json")).status(),
  ).toBe(401);
  await visitor.close();
});

test("local account setup, direct login, direct grant and password change need no groups", async ({
  browser,
  page,
}) => {
  await page.goto(base + "/auth/login");
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  await expect(page).toHaveURL(base + "/");
  await page.goto(base + "/access/");
  await page
    .getByText("Invite someone without Google", { exact: true })
    .click();
  const invite = page.locator("#invite-local");
  await invite.getByLabel("Name", { exact: true }).fill("Independent reader");
  await invite
    .getByLabel("Email", { exact: true })
    .fill("independent@example.invalid");
  await invite.getByRole("button", { name: "Create setup link" }).click();
  await expect(invite.getByLabel("Private setup link")).toHaveValue(/#.+/);
  const setup = await invite.getByLabel("Private setup link").inputValue();
  const context = await browser.newContext();
  const local = await context.newPage();
  await local.goto(setup);
  await expect(local).toHaveURL(base + "/auth/local/setup");
  await local
    .getByLabel("Password", { exact: true })
    .fill("a fictional long passphrase");
  await local
    .getByLabel("Confirm password", { exact: true })
    .fill("a fictional long passphrase");
  await local.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(
    local.getByRole("heading", { name: "Your account is ready" }),
  ).toBeVisible();
  const account = control.localAccount("independent@example.invalid");
  expect(
    control.db
      .prepare("SELECT count(*) n FROM organization_members WHERE principal=?")
      .get(account.principal).n,
  ).toBe(0);
  expect(
    control.db
      .prepare("SELECT count(*) n FROM group_members WHERE principal=?")
      .get(account.principal).n,
  ).toBe(0);
  await page.reload();
  const row = page
    .locator("#access form")
    .filter({ has: page.getByLabel("Independent reader access") });
  await row.getByLabel("Independent reader access").selectOption("reader");
  await row.getByRole("button", { name: "Save access" }).click();
  await expect(row.getByRole("status")).toHaveText("Saved");
  await local.goto(base + "/wiki/guide/");
  await expect(local.locator("article")).toBeVisible();
  await local.getByRole("button", { name: "Account menu" }).click();
  await local.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(
    local.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await local
    .getByLabel("Email", { exact: true })
    .fill("independent@example.invalid");
  await local
    .getByLabel("Password", { exact: true })
    .fill("a fictional long passphrase");
  await local.getByRole("button", { name: "Sign in", exact: true }).click();
  await local.getByRole("button", { name: "Account menu" }).click();
  await expect(
    local.getByRole("menuitem", { name: "Your account", exact: true }),
  ).toBeVisible();
  await local
    .getByRole("menuitem", { name: "Your account", exact: true })
    .click();
  await local
    .getByLabel("Current password", { exact: true })
    .fill("a fictional long passphrase");
  await local
    .getByLabel("New password", { exact: true })
    .fill("a different long passphrase");
  await local
    .getByLabel("Confirm new password", { exact: true })
    .fill("a different long passphrase");
  await local.getByRole("button", { name: "Change password" }).click();
  await expect(local.getByRole("status")).toContainText("Password changed");
  await context.close();
});

test("account menu keeps the header compact and supports keyboard and touch", async ({
  page,
}) => {
  await page.goto(base + "/auth/login");
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    for (const colorScheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto(base);
      const trigger = page.getByRole("button", { name: "Account menu" });
      await expect(trigger).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Sign out" }),
      ).toBeHidden();
      const box = await page.locator(".site-header").boundingBox();
      expect(box.y).toBeLessThan(10);
      expect(box.height).toBeLessThan(140);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const brand = await page.locator(".brand").boundingBox();
      const account = await trigger.boundingBox();
      expect(account.width).toBeGreaterThanOrEqual(44);
      expect(account.height).toBeGreaterThanOrEqual(44);
      expect(brand.x + brand.width).toBeLessThanOrEqual(account.x);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Your account" }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Manage access" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.screenshot({
        path: `.runtime/header-review/${width}-${colorScheme}-menu.png`,
      });
      const heading = await page.locator("h1").first().boundingBox();
      await page.mouse.click(heading.x + 4, heading.y + heading.height / 2);
      await expect(page.getByRole("menu")).toBeHidden();
      await page.screenshot({
        path: `.runtime/header-review/${width}-${colorScheme}.png`,
      });
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.goto(base + "/account/");
      await page.screenshot({
        path: `.runtime/header-review/${width}-${colorScheme}-account.png`,
        fullPage: true,
      });
    }
  }
});

test("OIDC returns a signed-out reader to the requested article and anchor", async ({
  page,
}) => {
  const destination = "/wiki/guide/?source=trace#original-section";
  await page.goto(base + destination);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  await expect(page).toHaveURL(base + destination);
  await expect(page.locator("article")).toBeVisible();
});

test("local login restores the requested article and anchor", async ({
  page,
}) => {
  const owner = control.identity(identity.issuer, "owner");
  const invited = control.inviteLocal(
    owner.id,
    "deep-link@example.invalid",
    "Deep link reader",
  );
  const { hashPassword } = await import("../../src/passwords.mjs");
  control.acceptInvitation(
    invited.token,
    await hashPassword("a fictional deep link password"),
  );
  control.grant(owner.id, invited.id, "reader");
  const destination = "/wiki/guide/?source=trace#original-section";
  await page.goto(base + destination);
  await page
    .getByLabel("Email", { exact: true })
    .fill("deep-link@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a fictional deep link password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(base + destination);
  await expect(page.locator("article")).toBeVisible();
});

test("create an agent in the browser, grant access, and approve a remote connection", async ({
  page,
}) => {
  const { createHash } = await import("node:crypto");
  await page.goto(base + "/agents/");
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Agents", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create an agent" }).first().click();
  const form = page.locator('[data-agent-action="create"]');
  await form.getByLabel("Name", { exact: true }).fill("Browser Researcher");
  await form.getByLabel("Instructions").fill("Read relevant evidence.");
  await form.getByRole("button", { name: "Create agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Browser Researcher" }),
  ).toBeVisible();
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Browser Researcher" }) });
  await section.getByRole("button", { name: "Permissions" }).click();
  const access = page.getByRole("dialog");
  await access
    .getByLabel("Wiki access", { exact: true })
    .selectOption("reader");
  await access
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(section).toContainText("Read only");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`agents-${width}-${theme}.png`),
        fullPage: true,
      });
    }
    await section.getByRole("button", { name: "Edit agent" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`agent-dialog-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      section.getByRole("button", { name: "Edit agent" }),
    ).toBeFocused();
  }
  await section.getByRole("button", { name: "Edit agent" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Instructions", { exact: true })
    .fill("Read relevant evidence and cite your sources.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(section).toContainText("cite your sources");
  const owner = control.identity(identity.issuer, "owner");
  const invited = control.inviteLocal(
    owner.id,
    "agent-collaborator@example.invalid",
    "Agent collaborator",
  );
  control.grant(owner.id, invited.id, "reader");
  await page.reload();
  await section.getByRole("button", { name: "Permissions" }).click();
  await access.getByLabel("Person", { exact: true }).selectOption(invited.id);
  await access
    .getByRole("button", { name: "Grant permission", exact: true })
    .click();
  await expect(
    access.getByText("Agent collaborator", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("agent-permissions-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("agent-permissions-mobile.png"),
    fullPage: true,
  });
  await access
    .getByRole("button", { name: "Revoke Use agent from Agent collaborator" })
    .click();
  await expect(
    access.getByText("Agent collaborator", { exact: true }),
  ).not.toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Your connections/ }).click();
  await expect(
    page.getByRole("heading", { name: "No active connections" }),
  ).toBeVisible();
  const reg = await (
    await page.request.post(base + "/oauth/register", {
      data: {
        client_name: "Browser test",
        redirect_uris: ["http://127.0.0.1:18765/callback"],
      },
    })
  ).json();
  const params = new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: reg.redirect_uris[0],
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256")
      .update("v".repeat(64))
      .digest("base64url"),
    resource: base + "/mcp",
    state: "browser-test",
  });
  await page.goto(base + "/oauth/authorize?" + params);
  await expect(
    page.getByRole("heading", { name: "Choose an agent" }),
  ).toBeVisible();
  await page.getByLabel("Browser Researcher — read only").check();
  await page.screenshot({
    path: test.info().outputPath("consent.png"),
    fullPage: true,
  });
  await page.route("http://127.0.0.1:18765/callback**", (route) =>
    route.fulfill({ body: "Connected" }),
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/callback\?.*code=/);
  expect(new URL(page.url()).searchParams.get("state")).toBe("browser-test");
  const token = await page.request.post(base + "/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id: reg.client_id,
      code: new URL(page.url()).searchParams.get("code"),
      redirect_uri: reg.redirect_uris[0],
      code_verifier: "v".repeat(64),
      resource: base + "/mcp",
    },
  });
  expect(token.ok()).toBe(true);
  await page.goto(base + "/agents/");
  await page.getByRole("tab", { name: /Your connections/ }).click();
  await expect(
    page.getByRole("heading", { name: "Browser test" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("agent-connections-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No active connections" }),
  ).toBeVisible();
});

test("signed-out pages omit navigation and search until sign-in", async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width === 390 ? "light" : "dark" });
    for (const path of ["/traces/", "/auth/local/setup"]) {
      await page.goto(base + path);
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toHaveCount(0);
      await expect(
        page.locator(
          "#quick-search, #account-menu, .header-search, .mobile-search",
        ),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Agent API", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByLabel("Appearance")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.goto(base + "/traces/");
    await page.screenshot({
      path: test.info().outputPath(`signed-out-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page
    .getByRole("button", { name: "Example owner", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page
    .locator("#quick-search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
