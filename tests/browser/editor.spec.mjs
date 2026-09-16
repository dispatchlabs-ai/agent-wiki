import { test, expect } from "@playwright/test";
import { once } from "node:events";
import { createWiki } from "../../src/server.mjs";
import { fixture } from "../helpers.mjs";
let app, cleanup, base;
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
  app = createWiki({ repo, origin: base, write: true });
  app.listen(port, "127.0.0.1");
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
test("browser loads modules, saves and repeats an unchanged edit", async ({
  page,
}) => {
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
