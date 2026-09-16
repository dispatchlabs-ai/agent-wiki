import { test, expect } from "@playwright/test";
import { once } from "node:events";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createWiki } from "../../src/server.mjs";
import { fixture, commit } from "../helpers.mjs";
import { markdown } from "../../src/git-wiki.mjs";
import { importTrace } from "../../src/traces.mjs";
let app, cleanup, base, repo, trace;
const source = fs.readFileSync(
  new URL("../fixtures/rich-markdown.md", import.meta.url),
  "utf8",
);
const data = {
  title: "A living knowledge base",
  description:
    "Readable explanations, rich Markdown, and a path back to the original conversation.",
  topic: "Guides",
};
const review = path.resolve(".runtime/rich-review");
test.beforeAll(async () => {
  repo = fixture({ after: (fn) => (cleanup = fn) });
  fs.writeFileSync(path.join(repo, "wiki/guide.md"), markdown(data, source));
  commit(repo, "Add synthetic rich Markdown");
  const capture = path.join(repo, ".git/synthetic.jsonl");
  fs.writeFileSync(
    capture,
    [
      { type: "session", id: "synthetic-rich-session", version: 3 },
      {
        type: "message",
        id: "user-question",
        message: {
          role: "user",
          content:
            "Show a readable explanation with math and diagrams.[^a]\n\n[^a]: First message note.",
        },
      },
      {
        type: "message",
        id: "assistant-answer",
        parentId: "user-question",
        message: {
          role: "assistant",
          content:
            source + "\nAnother reference[^a].\n\n[^a]: Second message note.",
        },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  const traces = path.join(repo, ".git/traces");
  trace = importTrace(traces, capture, "A conversation with rich Markdown");
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  app = createWiki({ repo, traces, origin: base, write: true }).listen(
    port,
    "127.0.0.1",
  );
  await once(app, "listening");
  fs.mkdirSync(review, { recursive: true });
});
test.afterAll(async () => {
  if (app)
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
  cleanup?.();
});
test("rich articles and conversations work from small phone to large desktop", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [320, 390, 768, 1024, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      for (const route of ["/wiki/guide/", `/traces/${trace.id}/`]) {
        await page.goto(base + route);
        await expect(page.locator(".content-tabs")).toBeVisible();
        await expect(page.locator("math").first()).toBeVisible();
        await expect(page.locator(".callout-note")).toBeVisible();
        await page
          .getByRole("button", { name: "Show diagram", exact: true })
          .click();
        await expect(
          page.frameLocator(".diagram iframe").locator("svg"),
        ).toBeVisible();
        await expect(page.locator(".render-diagram")).toHaveText(
          "Diagram shown",
        );
        await page.locator(".diagram").screenshot({
          path: path.join(
            review,
            `${width}-${theme}-${route.startsWith("/traces") ? "conversation" : "article"}-diagram.png`,
          ),
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${width} ${theme} ${route}`,
        ).toBeTruthy();
        await page.getByRole("tab", { name: "Edit", exact: true }).click();
        await expect(
          page.getByRole("tabpanel", { name: "Edit", exact: true }),
        ).toContainText("save a revision");
        await page.getByRole("tab", { name: "Read", exact: true }).focus();
        await page.keyboard.press("ArrowRight");
        await expect(
          page.getByRole("tab", { name: "Edit", exact: true }),
        ).toBeFocused();
        await page.locator(".md-details summary").click();
        await expect(
          page.getByText(
            "This paragraph remains searchable even when the disclosure is closed.",
            { exact: true },
          ),
        ).toBeVisible();
        await page.keyboard.press("Control+Home");
        await page.screenshot({
          path: path.join(
            review,
            `${width}-${theme}-${route.startsWith("/traces") ? "conversation" : "article"}.png`,
          ),
          fullPage: true,
        });
      }
    }
  }
  expect(errors).toEqual([]);
});
test("search dialog traps focus, dismisses with Escape and restores the trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/wiki/guide/");
  const trigger = page.getByRole("button", { name: /^Search$/ });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Search the wiki")
    .fill("knowledge");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement.closest('[role="dialog"]'),
        ),
      )
      .toBeTruthy();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
test("Mermaid is isolated, retains source and renders with no external requests", async ({
  page,
}) => {
  const external = [];
  page.on("request", (req) => {
    if (!req.url().startsWith(base)) external.push(req.url());
  });
  await page.goto(base + "/wiki/guide/");
  await page.getByRole("button", { name: "Show diagram" }).click();
  const frame = page.frameLocator('iframe[title="Rendered Mermaid diagram"]');
  await expect(frame.locator("svg")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  await expect(page.locator(".diagram pre")).toContainText("flowchart LR");
  expect(external).toEqual([]);
});
test("live preview and later content commits use the shared renderer without rebuilding", async ({
  page,
}) => {
  await page.goto(base + "/wiki/guide/edit/");
  await expect(
    page.getByRole("button", { name: "Save revision" }),
  ).toBeEnabled();
  await page.getByLabel("Markdown", { exact: true }).fill(source);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator("#preview-body .content-tabs")).toBeVisible();
  await expect(page.locator("#preview-body math").first()).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  fs.writeFileSync(
    path.join(repo, "wiki/guide.md"),
    markdown(
      data,
      source +
        "\n> [!IMPORTANT]\n> A newly committed explanation appears immediately.\n",
    ),
  );
  commit(repo, "Update content while the engine remains running");
  await page.goto(base + "/wiki/guide/");
  await expect(page.locator(".callout-important")).toContainText(
    "appears immediately",
  );
});
test("footnote references stay within their original message and source links remain unchanged", async ({
  page,
}) => {
  await page.goto(base + `/traces/${trace.id}/`);
  const ids = await page
    .locator("[id]")
    .evaluateAll((nodes) => nodes.map((n) => n.id));
  expect(ids.length).toBe(new Set(ids).size);
  const note = page.locator("#line-2 [data-footnote-ref]");
  await note.click();
  await expect(page.locator(new URL(page.url()).hash)).toContainText(
    "First message note",
  );
  await expect(page.locator("#line-2")).toHaveCount(1);
});
test("reading, disclosures and all tab contents survive without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(base + "/wiki/guide/");
  await expect(page.locator("math").first()).toBeVisible();
  await expect(
    page.getByText(
      "Write a new explanation, preview the Markdown, and save a revision with a useful summary.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Search", exact: true }),
  ).toBeVisible();
  await context.close();
});
test("printing exposes every tab and vendor CORS never applies to content", async ({
  page,
}) => {
  await page.goto(base + "/wiki/guide/");
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByText(
      "Write a new explanation, preview the Markdown, and save a revision with a useful summary.",
      { exact: true },
    ),
  ).toBeVisible();
  const vendor = await page.request.get(base + "/assets/vendor/ui.js");
  expect(vendor.headers()["access-control-allow-origin"]).toBe("*");
  const content = await page.request.get(
    base + "/assets/vendor/../../api/articles/guide/current.json",
  );
  expect(content.headers()["access-control-allow-origin"]).toBeUndefined();
  const diagram = await page.request.get(base + "/assets/diagram.html");
  expect(diagram.headers()["content-security-policy"]).toContain(
    "sandbox allow-scripts",
  );
});
