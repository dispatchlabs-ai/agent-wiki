import { test, expect } from "@playwright/test";
import { once } from "node:events";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createWiki } from "../../src/server.mjs";
import { fixture, commit } from "../helpers.mjs";
import { markdown } from "../../src/git-wiki.mjs";
import { importTrace } from "../../src/traces.mjs";
import { indexTraces } from "../../src/trace-search.mjs";
let app, cleanup, base, trace;
const review = path.resolve(".runtime/responsive-review");
test.beforeAll(async () => {
  const repo = fixture({ after: (fn) => (cleanup = fn) });
  const traces = path.join(repo, ".git/traces");
  trace = importTrace(
    traces,
    new URL("../../examples/traces/pi.jsonl", import.meta.url),
    "Cedar prototype discussion",
  );
  importTrace(
    traces,
    new URL("../../examples/traces/codex.jsonl", import.meta.url),
    "Atlas prototype decision",
  );
  const growing = path.join(repo, ".git", "growing-pi.jsonl");
  fs.writeFileSync(
    growing,
    fs.readFileSync(
      new URL("../../examples/traces/pi.jsonl", import.meta.url),
      "utf8",
    ) +
      "\n" +
      JSON.stringify({
        type: "message",
        id: "new-record",
        message: { role: "user", content: "New evidence in a later capture." },
      }),
  );
  importTrace(traces, growing, "Cedar later capture");
  indexTraces(traces);
  const data = {
    title: "Atlas Labs",
    description:
      "Applied research, prototypes, and decisions grounded in evidence.",
    topic: "Organizations",
    related: ["cedar"],
    questions: ["Which prototype should enter the next field trial?"],
    sources: [
      {
        url: `/traces/${trace.id}/?page=1#line-3`,
        title: "Cedar prototype discussion",
      },
    ],
  };
  const body = `## Overview\n\nAtlas Labs develops reliable research tools with [[cedar|Cedar Instruments]]. See the [original discussion](/traces/${trace.id}/?page=1#line-3).\n\n## Current work\n\n| Area | Description | Status |\n| --- | --- | --- |\n| Field sensors | Evaluate prototypes under changing conditions | Active |\n| Research notes | Keep findings linked to their evidence | In progress |\n\n## Next steps\n\nReview the prototype results before extending the pilot.\n`;
  fs.writeFileSync(path.join(repo, "wiki/guide.md"), markdown(data, body));
  fs.writeFileSync(
    path.join(repo, "wiki/cedar.md"),
    markdown(
      {
        title: "Cedar Instruments",
        description: "Environmental sensors and field testing.",
        topic: "Organizations",
      },
      "## Overview\n\nCedar builds prototype sensors. See [[guide|Atlas Labs]].\n",
    ),
  );
  fs.writeFileSync(
    path.join(repo, "wiki/research.md"),
    markdown(
      {
        title: "Prototype research",
        description: "The questions behind the next experiment.",
        topic: "Research",
      },
      "## Scope\n\nInvestigate the next prototype with [[guide|Atlas Labs]].\n",
    ),
  );
  commit(repo, "Describe prototype collaboration");
  fs.writeFileSync(
    path.join(repo, "wiki/guide.md"),
    markdown(
      data,
      body.replace(
        "Review the prototype results before extending the pilot.",
        "Run a limited field pilot and record the results before extending deployment.",
      ),
    ),
  );
  commit(repo, "Choose a limited pilot with recorded results");
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
test("all responsive views reflow, retain navigation and support both themes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const routes = [
    "/",
    "/wiki/",
    "/search/?q=prototype",
    "/wiki/guide/",
    "/wiki/guide/history/",
    "/wiki/guide/compare/?from=2&to=3",
    "/wiki/guide/revision/2/",
    "/wiki/guide/sources/",
    "/traces/",
    `/traces/${trace.id}/`,
    "/wiki/guide/edit/",
  ];
  for (const width of [320, 390, 768, 1024, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      for (let i = 0; i < routes.length; i++) {
        await page.goto(base + routes[i]);
        await expect(page.locator("h1")).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Main navigation" }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${routes[i]} ${width} ${theme} overflows`,
        ).toBeTruthy();
        if (width !== 768 && (theme === "light" || i === 0))
          await page.screenshot({
            path: path.join(
              review,
              `${width}-${theme}-${String(i).padStart(2, "0")}.png`,
            ),
            fullPage: true,
          });
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(base + "/wiki/guide/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page
    .getByRole("menuitemradio", { name: "System", exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(errors).toEqual([]);
});
test("mobile filters, source anchors and preview preserve useful interactions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/wiki/");
  await page.getByText("Filter articles", { exact: true }).click();
  await page.getByLabel("Topic", { exact: true }).selectOption("Research");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "Prototype research" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cedar Instruments" }),
  ).toHaveCount(0);
  await page.goto(base + `/traces/${trace.id}/?page=1#line-3`);
  await expect(page.locator("#line-3")).toBeVisible();
  await page
    .getByRole("button", { name: "Source records", exact: true })
    .click();
  await expect(
    page.getByText("Original source record", { exact: true }).first(),
  ).toBeVisible();
  await page.goto(base + "/wiki/guide/edit/");
  await expect(
    page.getByRole("button", { name: "Save revision" }),
  ).toBeEnabled();
  await page
    .getByLabel("Markdown", { exact: true })
    .fill(
      "## Draft preview\n\nA **safe preview**.\n\n<script>alert('bad')</script>",
    );
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator("#preview-body h2")).toHaveText("Draft preview");
  await expect(page.locator("#preview-body script")).toHaveCount(0);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect(page.getByLabel("Markdown", { exact: true })).toHaveValue(
    /Draft preview/,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "Split", exact: true }).click();
  await expect(page.getByLabel("Markdown", { exact: true })).toBeVisible();
  await expect(page.locator("#preview-body")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("tab", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByLabel("Change summary")
    .fill("Check responsive draft preservation");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(page.getByRole("status")).toContainText("Saved in Git");
});

test("session groups expose every immutable snapshot on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/traces/");
  const group = page.locator(".entry").filter({ hasText: "2 snapshots" });
  await expect(group).toHaveCount(1);
  await group.getByRole("link", { name: "View session snapshots" }).click();
  await expect(page.locator(".entry")).toHaveCount(2);
  await page
    .getByRole("link", { name: "Cedar prototype discussion", exact: true })
    .click();
  await expect(page.locator("#line-3")).toHaveCount(1);
  await page.goto(base + "/traces/?view=snapshots");
  await expect(page.locator(".entry")).toHaveCount(3);
});

test("logical trace hits expose their original snapshot citations", async ({
  page,
}) => {
  await page.goto(base + "/search/?q=prototype&type=traces");
  const disclosure = page
    .locator("details")
    .filter({ has: page.getByText("Seen in 2 snapshots", { exact: true }) })
    .first();
  await expect(disclosure).toBeVisible();
  await disclosure.locator("summary").click();
  const citation = disclosure.getByRole("link").first();
  await expect(citation).toHaveAttribute(
    "href",
    /\/traces\/[a-f0-9]{64}\/\?page=1#line-\d+/,
  );
  await citation.click();
  await expect(page.locator(locationSafeHash(page.url()))).toBeVisible();
});
function locationSafeHash(url) {
  return new URL(url).hash;
}

test("provenance pages expose navigable citations on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.request.get(
    base + "/api/traces/search?q=prototype",
  );
  const hit = (await response.json()).results.find(
    (r) => r.snapshot_count === 2,
  );
  await page.goto(base + `/traces/provenance/?key=${hit.logical_key}&limit=1`);
  await expect(
    page.getByRole("heading", { name: "Source citations", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.getByRole("link", { name: "Next citations" }).click();
  await expect(page.getByRole("link", { name: /Imported .*line/ })).toHaveCount(
    1,
  );
  await page.getByRole("link", { name: /Imported .*line/ }).click();
  await expect(page.locator("#line-3")).toHaveCount(1);
});

test("home components keep search, article previews and navigation clear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(base + "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Recent updates",
  );
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("link", { name: "Articles", exact: true }),
  ).toHaveAttribute("href", "/wiki/");
  await expect(
    nav.getByRole("link", { name: "Conversations", exact: true }),
  ).toHaveAttribute("href", "/traces/");
  const card = page.locator(".article-card").filter({
    has: page.getByRole("heading", { name: "Atlas Labs", exact: true }),
  });
  await expect(card).toContainText(
    "Applied research, prototypes, and decisions grounded in evidence.",
  );
  await expect(card).not.toContainText(
    "Choose a limited pilot with recorded results",
  );
  await expect(card.getByRole("link", { name: "Read article" })).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "View changes to Atlas Labs" }),
  ).toHaveAttribute("href", /compare/);
  const trigger = page.locator(".quick-search-trigger");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox").fill("prototype");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search\/\?q=prototype/);
  await expect(page.locator("#search-query")).toHaveValue("prototype");
});

test("article contents never overlap related links while scrolling", async ({
  page,
}) => {
  for (const width of [390, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 600 });
    await page.goto(base + "/wiki/guide/");
    const sidebar = page.locator(".article-layout .sidebar");
    const contents = sidebar.locator(".desktop-toc");
    const links = sidebar.locator(".article-side-links");
    if (!(await contents.isVisible())) continue;
    for (const scrollY of [0, 150, 300, 500]) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      const tocBox = await contents.boundingBox();
      const linksBox = await links.boundingBox();
      expect(tocBox.y + tocBox.height).toBeLessThanOrEqual(linksBox.y);
    }
  }
});
