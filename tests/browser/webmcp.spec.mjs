import { test, expect } from "@playwright/test";
import { once } from "node:events";
import net from "node:net";
import { createWiki } from "../../src/server.mjs";
import { GitWiki, git } from "../../src/git-wiki.mjs";
import { fixture, update } from "../helpers.mjs";
import { evidenceFixture, evidenceId, fileId } from "../evidence-fixture.mjs";

// Use the browser's real registration, schema validation and execution. No shim.
test.use({
  launchOptions: { args: ["--enable-experimental-web-platform-features"] },
});
let app, backend, repo, base, cleanup;
test.beforeEach(async () => {
  repo = fixture({
    after: (fn) => {
      cleanup = fn;
    },
  });
  backend = await evidenceFixture();
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  base = `http://127.0.0.1:${port}`;
  app = createWiki({
    repo,
    origin: base,
    evidenceUrl: backend.url,
    write: true,
  });
  app.listen(port, "127.0.0.1");
  await once(app, "listening");
});
test.afterEach(async () => {
  await new Promise((r) => {
    app.close(r);
    app.closeAllConnections();
  });
  await backend.close();
  cleanup();
});
async function tools(page) {
  await page.goto(base + "/wiki/guide/");
  await expect(page.locator("html")).toHaveAttribute("data-webmcp", "ready");
  return page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => t.name),
  );
}
const call = (page, name, input) =>
  page.evaluate(
    async ({ name, input }) => {
      const context = document.modelContext;
      const tool = (await context.getTools()).find((t) => t.name === name);
      // The pinned Chromium release takes serialized input at this native boundary.
      return JSON.parse(await context.executeTool(tool, JSON.stringify(input)));
    },
    { name, input },
  );

test("native WebMCP reads, paginates, previews and inspects originals", async ({
  page,
}) => {
  const registered = await tools(page);
  const advertised = await (
    await page.request.get(base + "/api/articles/authoring.json")
  ).json();
  expect(registered.sort()).toEqual(advertised.tools.sort());
  expect(registered).toContain("wiki.preview");
  expect(registered).toContain("wiki.file");
  expect((await call(page, "wiki.search", { q: "start" })).total).toBe(1);
  expect(
    (await call(page, "wiki.read", { id: "guide", revision: 1 })).body,
  ).toContain("Start here");
  expect(
    (await call(page, "wiki.history", { id: "guide" })).revisions,
  ).toHaveLength(1);
  expect(
    (
      await call(page, "wiki.traceSearch", {
        q: "prototype",
        format: "claude",
        machine: "fixture-host",
      })
    ).total,
  ).toBe(1);
  expect(
    (
      await call(page, "wiki.traces", {
        format: "claude",
        machine: "fixture-host",
        limit: 1,
      })
    ).total,
  ).toBe(1);
  const dialogue = await call(page, "wiki.trace", { id: evidenceId });
  expect(
    dialogue.messages.every((m) => ["user", "assistant"].includes(m.role)),
  ).toBe(true);
  expect(dialogue.messages[0].attachments[0]).not.toHaveProperty("preview");
  const activity = await call(page, "wiki.trace", {
    id: evidenceId,
    kind: "tool",
    after: "2026-01-01T10:01:00Z",
    before: "2026-01-01T10:02:00Z",
  });
  expect(activity.messages[0].text).toBe("Recorded tool output");
  expect(
    (
      await call(page, "wiki.trace", {
        id: evidenceId,
        kind: "tool",
        before: "2026-01-01T10:01:00Z",
      })
    ).messages,
  ).toHaveLength(0);
  expect(
    await call(page, "wiki.trace", { id: evidenceId, after: "yesterday" }),
  ).toMatchObject({ isError: true, status: 400 });
  const next = await call(page, "wiki.trace", { id: evidenceId, page: 2 });
  expect(next.offset).toBe(100);
  expect(next.messages).toHaveLength(2);
  expect(
    (await call(page, "wiki.trace", { id: evidenceId, offset: 100 })).messages,
  ).toEqual(next.messages);
  expect(
    (await call(page, "wiki.trace", { id: evidenceId, page: 3, limit: 40 }))
      .offset,
  ).toBe(80);
  expect(
    await call(page, "wiki.trace", { id: evidenceId, page: 2, offset: 0 }),
  ).toMatchObject({ isError: true, status: 400, code: "INVALID_TRACE_PAGE" });
  const event = await call(page, "wiki.trace", {
    id: evidenceId,
    event: "old-tool",
  });
  expect(event.kind).toBe("tool");
  expect(event.messages[0].id).toBe("tool-event");
  const chunk = await call(page, "wiki.trace", {
    id: evidenceId,
    event: "old-tool",
    textOffset: 9,
    textLimit: 4,
  });
  expect(chunk.messages).toHaveLength(1);
  expect(chunk.messages[0].text).toBe("tool");
  expect(chunk.messages[0].textWindow).toMatchObject({
    offset: 9,
    returnedChars: 4,
    totalChars: 20,
    nextTextOffset: 13,
  });
  expect(
    (
      await call(page, "wiki.trace", {
        id: evidenceId,
        event: "old-tool",
        textLimit: 0,
      })
    ).messages[0].text,
  ).toBe("");
  expect(
    (await call(page, "wiki.trace", { id: evidenceId, event: "old-tool" }))
      .messages[0].text,
  ).toBe("Recorded tool output");

  const before = git(repo, ["rev-parse", "HEAD"]);
  const preview = await call(page, "wiki.preview", {
    body: "**Preview** <script>alert(1)</script>",
  });
  expect(preview.html).toContain("<strong>Preview</strong>");
  expect(preview.html).not.toContain("<script>");
  expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
  const file = await call(page, "wiki.file", { asset: fileId });
  expect(file.attachment).toMatchObject({
    status: "available",
    name: "notes.md",
    preview_truncated: true,
  });
  expect(file.attachment.download_url).toContain("?download=notes.md");
  const bytes = await page.request.get(base + file.attachment.download_url, {
    headers: { Range: "bytes=0-9" },
  });
  expect(bytes.status()).toBe(206);
  expect(bytes.headers()["content-disposition"]).toContain("attachment;");
  const catalogSchema = await page.evaluate(
    async () =>
      (await document.modelContext.getTools()).find(
        (t) => t.name === "wiki.traces",
      ).inputSchema,
  );
  expect(
    (typeof catalogSchema === "string"
      ? JSON.parse(catalogSchema)
      : catalogSchema
    ).properties,
  ).not.toHaveProperty("session_id");
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  expect(
    await page.evaluate(
      async () => (await document.modelContext.getTools()).length,
    ),
  ).toBe(0);
});

test("native save validates quotes atomically and retains actionable failures and retries", async ({
  page,
}) => {
  await tools(page);
  const source = {
    conversation: evidenceId,
    event: "old-tool",
    quote: "Recorded tool output",
  };
  const draft = {
    operation_id: "native-quoted-create",
    updates: [{ ...update("quoted"), evidence: [source] }],
  };
  const saved = await call(page, "wiki.save", draft);
  expect(saved).toMatchObject({ state: "saved", publication: "live" });
  const quoted = await call(page, "wiki.read", { id: "quoted" });
  expect(quoted.evidence[0]).toMatchObject({
    conversation: evidenceId,
    event: "tool-event",
    quote: source.quote,
    attribution: "tool",
    line: 200,
  });
  const changed = {
    operation_id: "native-preserve",
    updates: [
      {
        ...update("quoted", "Updated explanation."),
        expected_revision_id: quoted.revision_id,
      },
    ],
  };
  expect((await call(page, "wiki.save", changed)).state).toBe("saved");
  const current = await call(page, "wiki.read", { id: "quoted" });
  expect(current.evidence).toEqual(quoted.evidence);
  const before = git(repo, ["rev-parse", "HEAD"]);
  const rejected = await call(page, "wiki.save", {
    operation_id: "native-bad-quote",
    updates: [
      {
        ...update("quoted", "Must not be saved."),
        expected_revision_id: current.revision_id,
      },
      {
        ...update("invalid-quote"),
        evidence: [{ ...source, quote: "A fabricated quotation" }],
      },
    ],
  });
  expect(rejected).toMatchObject({
    isError: true,
    state: "rejected",
    status: 400,
    code: "EVIDENCE_MISMATCH",
  });
  expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
  expect(new GitWiki(repo).current("invalid-quote")).toBeNull();
  expect(
    await call(page, "wiki.save", { ...changed, operation_id: "native-stale" }),
  ).toMatchObject({ isError: true, status: 409, code: "REVISION_CONFLICT" });
  for (const [suffix, invalid] of [
    ["event", { ...source, event: "missing-event" }],
    ["conversation", { ...source, conversation: "chat-" + "f".repeat(24) }],
  ]) {
    expect(
      await call(page, "wiki.save", {
        operation_id: "native-missing-" + suffix,
        updates: [{ ...update("missing-" + suffix), evidence: [invalid] }],
      }),
    ).toMatchObject({ isError: true, status: 400, code: "EVIDENCE_MISMATCH" });
  }
  backend.state.offline = true;
  expect(await call(page, "wiki.save", draft)).toMatchObject({
    state: "already-saved",
    commit: saved.commit,
  });
  expect(
    await call(page, "wiki.save", {
      ...draft,
      updates: [{ ...draft.updates[0], body: "Different operation input" }],
    }),
  ).toMatchObject({ isError: true, status: 409, code: "OPERATION_CONFLICT" });
  expect(
    await call(page, "wiki.save", {
      operation_id: "native-offline",
      updates: [{ ...update("offline"), evidence: [source] }],
    }),
  ).toMatchObject({ isError: true, status: 503, code: "EVIDENCE_UNAVAILABLE" });
  expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
  const clear = {
    operation_id: "native-clear",
    updates: [
      {
        ...update("quoted"),
        expected_revision_id: current.revision_id,
        evidence: [],
      },
    ],
  };
  expect((await call(page, "wiki.save", clear)).state).toBe("saved");
  expect((await call(page, "wiki.read", { id: "quoted" })).evidence).toEqual(
    [],
  );
});

test("read-only native discovery offers preview and files without a save action", async ({
  page,
}) => {
  const port = app.address().port;
  await new Promise((r) => {
    app.close(r);
    app.closeAllConnections();
  });
  app = createWiki({
    repo,
    origin: base,
    evidenceUrl: backend.url,
    write: false,
  });
  app.listen(port, "127.0.0.1");
  await once(app, "listening");
  const registered = await tools(page);
  expect(registered).not.toContain("wiki.save");
  expect(registered).toContain("wiki.preview");
  expect(registered).toContain("wiki.file");
  const before = git(repo, ["rev-parse", "HEAD"]);
  expect(
    (await call(page, "wiki.preview", { body: "Read-only **preview**" })).html,
  ).toContain("<strong>preview</strong>");
  const response = await page.request.post(base + "/api/articles/edits", {
    headers: { Origin: base, "X-Wiki-Write": "1" },
    data: { operation_id: "must-not-save", updates: [update("blocked")] },
  });
  expect(response.status()).toBe(403);
  expect(git(repo, ["rev-parse", "HEAD"])).toBe(before);
});
