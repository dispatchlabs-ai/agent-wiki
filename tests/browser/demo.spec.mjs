import { test, expect } from "@playwright/test";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { fixture, commit } from "../helpers.mjs";
import { createWiki } from "../../src/server.mjs";
import { importTrace } from "../../src/traces.mjs";
import { indexTraces } from "../../src/trace-search.mjs";

let app, cleanup, base;
test.beforeAll(async () => {
  const repo = fixture({ after: (fn) => (cleanup = fn) });
  fs.cpSync(
    new URL("../../examples/wiki/", import.meta.url),
    path.join(repo, "wiki"),
    { recursive: true },
  );
  commit(repo, "Connect the prototype plan to its original decisions");
  const traces = path.join(repo, ".git", "traces");
  for (const name of ["codex", "pi"])
    importTrace(
      traces,
      new URL(`../../examples/traces/${name}.jsonl`, import.meta.url),
    );
  indexTraces(traces);
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  app = createWiki({ repo, traces, write: true, origin: base }).listen(
    port,
    "127.0.0.1",
  );
  await once(app, "listening");
});
test.afterAll(async () => {
  if (app)
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
  cleanup?.();
});

test("example citations lead from article and source list to original evidence", async ({
  page,
}) => {
  const directory = path.resolve(".runtime/ui-review");
  fs.mkdirSync(directory, { recursive: true });
  for (const [size, width, height] of [
    ["desktop", 1536, 1024],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [name, route] of [
      ["home", "/"],
      ["article", "/wiki/atlas-labs/"],
    ]) {
      await page.goto(base + route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: path.join(directory, `${size}-${name}.png`),
      });
    }
    const tabs = page.getByRole("navigation", { name: "Article views" });
    await expect(tabs.getByRole("link")).toHaveCount(3);
    await expect(
      page.getByRole("link", { name: "Edit article", exact: true }),
    ).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Edit article" })).toHaveCount(
      0,
    );
    await page
      .getByRole("link", { name: "recorded decision", exact: true })
      .click();
    await expect(page.locator("#line-8")).toBeVisible();
    await expect(page.locator("#line-8")).toContainText("two-week prototype");
    await page.goto(base + "/wiki/atlas-labs/");
    await page.getByRole("link", { name: "Sources · 2", exact: true }).click();
    await page
      .getByRole("link", { name: "Open original passage" })
      .nth(1)
      .click();
    await expect(page.locator("#line-5")).toBeVisible();
    await expect(page.locator("#line-5")).toContainText("Morgan reviewing it");
  }
});
