import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { test, expect } from "@playwright/test";
import { ControlStore } from "../../src/control-store.mjs";
import { AgentStore } from "../../src/agent-store.mjs";
import { createWiki } from "../../src/server.mjs";
import { fixture } from "../helpers.mjs";

let control, agents, app, listener, cleanup, base, manager, author, researcher;
test.beforeEach(async ({ context }) => {
  const repo = fixture({
    after: (fn) => {
      cleanup = fn;
    },
  });
  control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  manager = control.bootstrap({
    issuer: "https://accounts.google.com",
    subject: "synthetic-manager",
    name: "Morgan Ellis",
  });
  author = control.enroll({
    issuer: "https://accounts.google.com",
    subject: "synthetic-reader",
    name: "Alex Rivera",
  }).id;
  control.grant(manager, author, "reader");
  agents = new AgentStore(control);
  researcher = agents.create(author, {
    name: "Research Assistant",
    definition: {
      instructions: "Read the example articles.",
      tools: ["wiki.search", "wiki.read", "wiki.history"],
    },
  });
  const editor = agents.create(manager, {
    name: "Article Assistant",
    definition: {
      instructions: "Maintain the example articles.",
      tools: [
        "wiki.search",
        "wiki.read",
        "wiki.history",
        "wiki.preview",
        "wiki.save",
      ],
    },
  });
  control.grant(manager, editor.id, "editor");
  agents.permission(manager, editor.id, author, "invoke", true);
  const reader = agents.create(manager, {
    name: "Reference Reader",
    definition: {
      instructions: "Read example references.",
      tools: ["wiki.read"],
    },
  });
  control.grant(manager, reader.id, "reader");
  listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  base = `http://127.0.0.1:${listener.address().port}`;
  app = createWiki({
    repo,
    origin: base,
    control,
    localLogin: true,
    write: true,
    development: true,
  });
  app.listen(listener);
  await once(app, "listening");
  const session = control.session(manager);
  await context.addCookies([
    {
      name: "wiki_session",
      value: session.token,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});
test.afterEach(async () => {
  if (app)
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
  if (listener) await new Promise((resolve) => listener.close(resolve));
  control?.close();
  cleanup?.();
});

test("manager finds another person's agent, identifies its creator, and grants wiki access", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/access/#agents");
  const directory = page.getByRole("region", { name: "All agents" });
  const row = directory
    .getByRole("row")
    .filter({ hasText: "Research Assistant" });
  await expect(row).toContainText("Alex Rivera");
  await expect(row).toContainText("None");
  await page
    .getByRole("button", { name: "Research Assistant", exact: true })
    .click();
  const detail = page.getByRole("complementary", { name: "Agent details" });
  await expect(
    detail.getByRole("heading", { name: "Research Assistant" }),
  ).toBeVisible();
  await expect(detail.getByRole("button", { name: "Add person" })).toHaveCount(
    0,
  );
  await detail.getByText("Account details", { exact: true }).click();
  await expect(detail).toContainText("synthetic-reader");
  await detail
    .getByLabel("Wiki access", { exact: true })
    .selectOption("editor");
  await detail.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  expect(control.role(researcher.id)).toBe("editor");
  await expect(row).toContainText("Read and edit");
  expect(agents.allowed(manager, researcher.id, "invoke")).toBe(false);
  await page.reload();
  await expect(
    directory.getByRole("row").filter({ hasText: "Research Assistant" }),
  ).toContainText("Read and edit");
  await page
    .getByRole("searchbox", { name: "Search agents" })
    .fill("Alex Rivera");
  await expect(directory.getByRole("button")).toHaveCount(1);
  await page.getByLabel("Filter wiki access").selectOption("reader");
  await expect(directory).toContainText("No agents match these filters.");
  expect(errors).toEqual([]);
});

test("manager creates and shares an owned agent without silently granting wiki access", async ({
  page,
}) => {
  await page.goto(base + "/access/#agents");
  await page.getByRole("button", { name: "Create agent" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("New article helper");
  await dialog
    .getByLabel("Instructions")
    .fill("Use the synthetic article collection.");
  await dialog.getByLabel("Tools").fill("wiki.search\nwiki.read\nwiki.save");
  await dialog
    .getByRole("button", { name: "Create agent", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const detail = page.getByRole("complementary", { name: "Agent details" });
  await expect(
    detail.getByRole("heading", { name: "New article helper" }),
  ).toBeVisible();
  await expect(detail.getByLabel("Wiki access", { exact: true })).toHaveValue(
    "",
  );
  await expect(detail).toContainText("Morgan Ellis");
  await detail.getByRole("button", { name: "Add person" }).click();
  await dialog.getByLabel("Person", { exact: true }).selectOption(author);
  await dialog.getByRole("button", { name: "Grant permission" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(detail).toContainText("Alex Rivera");
  const created = agents
    .list(manager)
    .find((a) => a.name === "New article helper");
  expect(control.role(created.id)).toBe(null);
  expect(agents.allowed(author, created.id, "invoke")).toBe(true);
  await detail
    .getByRole("button", { name: "Revoke Use from Alex Rivera" })
    .click();
  await expect(
    detail.getByRole("button", { name: "Revoke Use from Alex Rivera" }),
  ).toHaveCount(0);
  expect(agents.allowed(author, created.id, "invoke")).toBe(false);
});

test("access screens remain usable on narrow screens and in both themes", async ({
  page,
}) => {
  await page.goto(base + "/access/#agents");
  await page
    .getByRole("button", { name: "Article Assistant", exact: true })
    .click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(
        page.getByRole("button", { name: "Article Assistant", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${width} ${theme}`,
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`access-agents-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page
    .getByRole("button", { name: "Research Assistant", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Research Assistant" }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "People", exact: true }).click();
  await expect(page.getByLabel("Alex Rivera access")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("access-people-320.png"),
    fullPage: true,
  });
});

test("failed saves show an error without reporting success or changing another agent", async ({
  page,
}) => {
  await page.goto(base + "/access/#agents");
  await page
    .getByRole("button", { name: "Research Assistant", exact: true })
    .click();
  await page.route("**/api/access", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "Access was revoked." }),
      });
    else await route.continue();
  });
  const detail = page.getByRole("complementary", { name: "Agent details" });
  await detail
    .getByLabel("Wiki access", { exact: true })
    .selectOption("editor");
  await detail.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Access was revoked.");
  expect(control.role(researcher.id)).toBe(null);
  await expect(page.getByText("Changes saved.", { exact: true })).toHaveCount(
    0,
  );
});
