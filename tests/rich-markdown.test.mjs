import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderMarkdown } from "../src/render.mjs";
import { sections } from "../src/markdown-structure.mjs";
const source = fs.readFileSync(
  new URL("./fixtures/rich-markdown.md", import.meta.url),
  "utf8",
);
test("rich Markdown retains structural content, math, highlights and source fallbacks", async () => {
  const html = await renderMarkdown(source);
  for (const pattern of [
    /callout-note/,
    /callout-tip/,
    /<math /,
    /<annotation encoding="application\/x-tex">/,
    /hljs-keyword/,
    /render-diagram/,
    /flowchart LR/,
    /<details class="md-details"/,
    /class="md-tabs"/,
    /class="md-tab"/,
    /<figure class="md-figure"/,
    /<figcaption class="md-caption"/,
    /record-table/,
    /data-footnote-ref/,
  ])
    assert.match(html, pattern);
  assert.equal(
    sections(source).some((s) =>
      s.body.includes("This paragraph remains searchable"),
    ),
    true,
  );
  assert.equal(
    sections(source).some((s) => s.body.includes("save a revision")),
    true,
  );
});
test("directives and math cannot inject arbitrary HTML, CSS or executable links", async () => {
  const html = await renderMarkdown(
    ':::note{title="Safe" onclick="alert(1)" style="color:red"}\n<script>alert(1)</script>\n:::\n\n:::unknown{foo="bar"}\nOriginal contents\n:::\n\n$\\href{javascript:alert(1)}{bad}$\n\n```html\n<img src=x onerror=alert(1)>\n```',
  );
  assert.doesNotMatch(html, /<(?:script|img)\b|onclick=|href="javascript:/);
  assert.match(html, /:::unknown/);
  assert.match(html, /Original contents/);
  assert.match(html, /&#x3C;/);
});
test("separate messages namespace footnotes without changing the original source or article anchors", async () => {
  const source = "Text[^a].\n\n[^a]: Explanation.";
  const first = await renderMarkdown(source, "event-first"),
    second = await renderMarkdown(source, "event-second");
  assert.match(first, /id="event-first-user-content-fn-a"/);
  assert.match(first, /href="#event-first-user-content-fn-a"/);
  assert.match(second, /id="event-second-user-content-fn-a"/);
  assert.doesNotMatch(first, /event-second/);
  assert.match(await renderMarkdown(source), /id="user-content-fn-a"/);
});
test("unknown code languages and invalid math stay readable", async () => {
  const html = await renderMarkdown(
    "```imaginary\nexact <source> & text\n```\n\n$\\unknowncommand{x}$",
  );
  assert.match(html, /exact &#x3C;source> &#x26; text/);
  assert.match(html, /unknowncommand/);
});
