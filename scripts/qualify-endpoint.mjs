#!/usr/bin/env node
// Explicit, synthetic read/write qualification of an operator-owned HTTPS Wiki.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    "bootstrap-file": { type: "string" },
    "credentials-file": { type: "string" },
    "previous-receipt": { type: "string" },
    receipt: { type: "string" },
    "allow-synthetic-write": { type: "boolean", default: false },
  },
});
assert(
  values["allow-synthetic-write"],
  "Explicit synthetic-write consent required",
);
assert(values.origin && values.receipt && values["credentials-file"]);
const origin = new URL(values.origin).origin;
assert(origin.startsWith("https://"), "A verified HTTPS origin is required");
assert(!fs.existsSync(values.receipt), "Do not overwrite an earlier receipt");
process.umask(0o077);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const privateRead = (file) => {
  assert(
    (fs.statSync(file).mode & 0o077) === 0,
    "Credential files must be private",
  );
  try {
    return read(file);
  } catch {
    throw new Error("Private input must contain valid JSON");
  }
};
const previous = values["previous-receipt"]
  ? read(values["previous-receipt"])
  : null;
const bootstrap = values["bootstrap-file"]
  ? privateRead(values["bootstrap-file"])
  : null;
const credentials = fs.existsSync(values["credentials-file"])
  ? privateRead(values["credentials-file"])
  : {
      email: "manager@example.invalid",
      password: `synthetic-${randomBytes(24).toString("base64url")}`,
    };
assert(
  typeof credentials.email === "string" && credentials.password?.length >= 15,
);
if (bootstrap) {
  let setup;
  try {
    setup = new URL(bootstrap.setup_url);
  } catch {
    throw new Error("Private bootstrap input must contain a valid setup URL");
  }
  assert(
    setup.origin === origin,
    "Bootstrap URL belongs to a different origin",
  );
}
assert(
  bootstrap || fs.existsSync(values["credentials-file"]),
  "Missing login credentials",
);
if (!fs.existsSync(values["credentials-file"])) {
  fs.mkdirSync(path.dirname(path.resolve(values["credentials-file"])), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(
    values["credentials-file"],
    JSON.stringify(credentials) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
let browser;
let stage = "browser_start";
const evidence = {
  schema: "agent-wiki.endpoint-qualification/v1",
  origin,
  started_at: new Date().toISOString(),
  checks: {},
};
try {
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  stage = "liveness";
  const health = await context.request.get(origin + "/healthz");
  assert.equal(health.status(), 200, "Liveness failed");
  evidence.checks.liveness = true;
  stage = bootstrap ? "browser_setup" : "browser_login";
  if (bootstrap) {
    await page.goto(bootstrap.setup_url, { waitUntil: "domcontentloaded" });
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill(credentials.password);
    await page
      .getByRole("button", { name: "Set password and sign in" })
      .click();
  } else {
    await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    const loggedIn = page.waitForResponse(
      (response) =>
        response.url() === origin + "/auth/local/login" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    assert.equal((await loggedIn).status(), 200, "Credential login failed");
  }
  await page.waitForURL(origin + "/", { timeout: 30000 });
  stage = "manager_identity";
  const profileResponse = await context.request.get(origin + "/api/me");
  assert.equal(profileResponse.status(), 200);
  const profile = await profileResponse.json();
  assert(profile.role === "manager" && profile.localAccount);
  evidence.principal = profile.id;
  if (previous)
    assert.equal(profile.id, previous.principal, "Manager identity changed");
  stage = "authenticated_readiness";
  const readiness = await context.request.get(
    origin + "/api/articles/health.json",
  );
  assert.equal(readiness.status(), 200, "Authenticated readiness failed");
  evidence.checks.authenticated_readiness = true;
  let requestId = 0;
  async function mcp(name, args) {
    const response = await context.request.post(origin + "/mcp", {
      headers: {
        Origin: origin,
        "X-Wiki-CSRF": profile.csrf,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
      },
      data: {
        jsonrpc: "2.0",
        id: ++requestId,
        method: "tools/call",
        params: { name, arguments: args },
      },
    });
    assert.equal(response.status(), 200, `MCP ${name} failed`);
    const text = await response.text();
    const envelope = JSON.parse(
      text.startsWith("event:")
        ? text
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6)
        : text,
    );
    assert(
      !envelope.error && !envelope.result?.isError,
      `MCP ${name} rejected`,
    );
    return JSON.parse(
      envelope.result.content.find((item) => item.type === "text").text,
    );
  }
  if (previous) {
    stage = "previous_content_and_identity";
    const retained = await mcp("wiki.read", { id: previous.article.id });
    assert.equal(
      retained.revision_id,
      previous.article.revision_id,
      "Previous article revision changed",
    );
    assert(
      retained.body.includes(previous.article.marker),
      "Previous acknowledged content missing",
    );
    evidence.checks.previous_content_and_identity = true;
  }
  const id = `portable-live-${randomUUID()}`;
  stage = "mcp_write_read";
  const marker = `Synthetic HTTPS qualification ${randomUUID()}`;
  const saved = await mcp("wiki.save", {
    operation_id: randomUUID(),
    updates: [
      {
        id,
        expected_revision_id: null,
        title: "Portable deployment qualification",
        description: "Synthetic deployment test",
        topic: "Qualification",
        body: marker + "\n",
        summary: "Verify authenticated deployed write",
      },
    ],
  });
  assert.equal(saved.actor, profile.id, "Write attribution changed");
  const first = await mcp("wiki.read", { id });
  assert(first.body.includes(marker));
  stage = "browser_write_read";
  await page.goto(origin + `/wiki/${id}/edit/`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("status").filter({ hasText: "Ready to edit." }).waitFor();
  const markdown = marker + "\n\nBrowser edit on the deployed service.\n";
  await page.getByLabel("Markdown", { exact: true }).fill(markdown);
  await page.getByLabel("Change summary").fill("Verify deployed browser write");
  await page.getByRole("button", { name: "Save revision" }).click();
  await page.getByRole("status").filter({ hasText: "Saved in Git" }).waitFor();
  await page.goto(origin + `/wiki/${id}/`, { waitUntil: "domcontentloaded" });
  assert(
    (await page.locator("article").textContent()).includes(
      "Browser edit on the deployed service.",
    ),
  );
  stage = "mcp_browser_readback";
  const final = await mcp("wiki.read", { id });
  assert(final.body.includes(markdown.trim()));
  assert.notEqual(final.revision_id, first.revision_id);
  assert.equal(errors.length, 0, "Browser reported an application error");
  evidence.article = { id, marker, revision_id: final.revision_id };
  Object.assign(evidence.checks, {
    functional_read: true,
    functional_write: true,
    browser_read_write: true,
    mcp_read_write: true,
  });
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  // Playwright transport errors can include cookie/header call logs. Never
  // retain raw messages, even when the password and setup token are known.
  evidence.failure_stage = stage;
  evidence.error_kind = ["AssertionError", "TimeoutError"].includes(error.name)
    ? error.name
    : "Error";
  process.exitCode = 1;
} finally {
  await browser?.close();
  evidence.completed_at = new Date().toISOString();
  fs.writeFileSync(values.receipt, JSON.stringify(evidence, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      passed: evidence.passed,
      checks: evidence.checks,
      receipt: path.resolve(values.receipt),
    }),
  );
}
