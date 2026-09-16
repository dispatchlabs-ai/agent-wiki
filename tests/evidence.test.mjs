import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { createWiki } from "../src/server.mjs";
import { renderMarkdown, sources } from "../src/render.mjs";
import { markdown } from "../src/git-wiki.mjs";
import { fixture, commit } from "./helpers.mjs";
import { evidenceFixture, evidenceId, fileId } from "./evidence-fixture.mjs";
async function app(t) {
  const backend = await evidenceFixture();
  t.after(() => backend.close());
  const repo = fixture(t);
  fs.writeFileSync(
    path.join(repo, "wiki/guide.md"),
    markdown(
      {
        title: "Prototype guide",
        description: "Synthetic source guide",
        kind: "guide",
        sources: [],
        evidence: [
          {
            url: `/conversations/${evidenceId}/#old-tool`,
            quote: "A source quote.",
            attribution: "user",
          },
        ],
      },
      `Prototype overview.\n\n- [w] Complete a prototype\n\n[Captured notes](/media/${fileId})\n`,
    ),
  );
  commit(repo, "Add synthetic evidence");
  const server = createWiki({
    repo,
    evidenceUrl: backend.url,
    origin: "http://wiki.invalid",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const get = (pathname, headers = {}) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: server.address().port,
            path: pathname,
            headers: { Host: "wiki.invalid", ...headers },
          },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString(),
              }),
            );
          },
        )
        .on("error", reject);
    });
  return { get, backend };
}
test("external evidence search does not delay article HTML and preserves filters", async (t) => {
  const { get, backend } = await app(t);
  backend.state.delay = 300;
  const page = await get("/search/?q=prototype&state=wip");
  assert.equal(page.status, 200);
  assert.match(page.body, /Prototype guide/);
  assert.match(page.body, /data-pending="true"/);
  assert.equal(
    backend.state.requests.filter((p) => p.startsWith("/v1/search")).length,
    0,
  );
  const search = JSON.parse(
    (
      await get(
        "/api/traces/search?q=prototype&format=claude&machine=fixture-host",
      )
    ).body,
  );
  assert.equal(search.total, 1);
  assert.equal(search.match, "conversation");
  assert.ok(
    backend.state.requests.some(
      (p) => p.includes("harness=claude") && p.includes("machine=fixture-host"),
    ),
  );
  assert.equal((await get("/api/traces/search?q=x&limit=0")).status, 400);
  const tasks = JSON.parse(
    (await get("/api/articles/search?q=prototype&state=wip")).body,
  );
  assert.equal(tasks.total, 1);
  const done = JSON.parse(
    (await get("/api/articles/search?q=prototype&state=done")).body,
  );
  assert.equal(done.total, 0);
});
test("native evidence reading preserves aliases, optional events, previews, and download ranges", async (t) => {
  const { get } = await app(t);
  const page = await get(`/conversations/${evidenceId}/`);
  assert.equal(page.status, 200);
  for (const text of [
    "Inherited from parent history",
    "rolled-back",
    "notes.md",
    "Preview shortened",
    "Open PDF",
    "missing.docx",
    "Source segment",
    "A source segment",
    "Next messages",
  ]) {
    if (text === "Source segment") continue;
    assert.ok(page.body.includes(text), text);
  }
  assert.doesNotMatch(page.body, /<script>bad/);
  const late = await get(`/conversations/${evidenceId}/?event=old-event`);
  assert.match(late.body, /id="old-event"/);
  assert.match(late.body, /101–102 of 102/);
  const tool = await get(`/api/traces/${evidenceId}.json?event=old-tool`);
  assert.equal(JSON.parse(tool.body).kind, "tool");
  const file = await get(`/files/${fileId}/`);
  assert.match(file.body, /Captured notes/);
  const bytes = await get("/media/" + fileId + "?download=notes.md", {
    Range: "bytes=0-7",
  });
  assert.equal(bytes.status, 206);
  assert.equal(bytes.body, "Captured");
  assert.match(bytes.headers["content-disposition"], /notes.md/);
  const sourcesPage = await get("/wiki/guide/sources/");
  assert.match(sourcesPage.body, /A source quote/);
  assert.match(sourcesPage.body, /old-tool/);
  const article = await get("/wiki/guide/");
  assert.match(article.body, /id="source-1"/);
  assert.match(article.body, /In progress/);
});
test("evidence failures remain visible while articles work", async (t) => {
  const { get, backend } = await app(t);
  backend.state.offline = true;
  assert.equal((await get("/wiki/guide/")).status, 200);
  assert.equal((await get("/api/traces/search?q=prototype")).status, 503);
  const page = await get("/search/?q=prototype&sync=1");
  assert.equal(page.status, 200);
  assert.match(page.body, /temporarily unavailable/);
  const health = JSON.parse((await get("/api/articles/health.json")).body);
  assert.equal(health.components.articleStorage.state, "ready");
  assert.equal(health.components.traceSearch.state, "degraded");
});
test("captured media never starts remote image requests and evidence records remain distinct", async () => {
  const html = await renderMarkdown(
    "![remote](https://example.invalid/pixel.png)\n\n![local](/media/" +
      "a".repeat(64) +
      ".png)\n\n`[w] literal`",
  );
  assert.doesNotMatch(html, /<img[^>]+https:/);
  assert.match(html, /image not captured/);
  assert.match(html, /Download image/);
  assert.match(html, /\[w\] literal/);
  const recorded = sources({
    body: "",
    sources: [],
    evidence: [
      { url: "/conversations/chat-x/#e", quote: "one" },
      { url: "/conversations/chat-x/#e", quote: "two" },
    ],
  });
  assert.equal(recorded.length, 2);
});

test("progressive evidence API forwards ranges and keeps previews opt-in", async (t) => {
  const { get, backend } = await app(t);
  const route = `/api/traces/${evidenceId}.json`;
  const dialogue = JSON.parse((await get(route)).body);
  assert.ok(
    dialogue.messages.every((m) => ["user", "assistant"].includes(m.role)),
  );
  assert.equal(dialogue.messages[0].attachments[0].preview, undefined);
  const range =
    "kind=tool&after=2026-01-01T10:01:00Z&before=2026-01-01T10:02:00Z";
  const tool = JSON.parse((await get(route + "?" + range)).body);
  assert.equal(tool.messages[0].text, "Recorded tool output");
  assert.ok(
    backend.state.requests.some(
      (r) => r.includes("after=") && r.includes("before="),
    ),
  );
  assert.equal(
    JSON.parse(
      (await get(route + "?kind=tool&before=2026-01-01T10:01:00Z")).body,
    ).total,
    0,
  );
  for (const q of [
    "after=tomorrow",
    "after=2026-01-01T10:00:00",
    "after=2026-01-02T00:00:00Z&before=2026-01-01T00:00:00Z",
  ])
    assert.equal((await get(route + "?" + q)).status, 400);
  const html = await get(
    `/conversations/${evidenceId}/?after=2026-01-01T09:00:00Z&limit=1`,
  );
  assert.match(html.body, /offset=1/);
  assert.match(html.body, /after=2026-01-01T09%3A00%3A00Z/);
});
