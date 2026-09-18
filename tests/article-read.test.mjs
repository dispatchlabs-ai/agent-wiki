import test from "node:test";
import assert from "node:assert/strict";
import {
  articleReadOptions,
  articleSections,
  selectArticle,
} from "../src/article-read.mjs";
import { sections } from "../src/markdown-structure.mjs";

const body =
  "Intro 🧭.\r\n\r\n## Plan *A*\r\nOriginal [source](https://example.org/).\r\n\r\n### Child\r\n```md\r\n## Fake\r\n```\r\nNested text.\r\n\r\n## Plan A\r\nSecond.\r\n\r\n## Plan A-1\r\nCollision.\r\n\r\nRésumé\r\n------\r\nLast.\r\n";
const article = {
  id: "guide",
  title: "Guide",
  description: "Synthetic",
  body,
  revision_id: "a".repeat(40),
  number: 2,
  commit: "b".repeat(40),
  url: "/wiki/guide/",
  custom: { preserved: true },
  backlinks: [{ id: "other" }],
};
test("section reads share search anchors, keep nested content, and preserve exact Markdown", () => {
  const outline = articleSections(body);
  assert.deepEqual(
    outline.map((s) => s.anchor),
    sections(body).map((s) => s.anchor),
  );
  assert.deepEqual(
    outline.map((s) => s.anchor),
    [
      "",
      "section-plan-a",
      "section-child",
      "section-plan-a-1",
      "section-plan-a-1-1",
      "section-résumé",
    ],
  );
  const selected = selectArticle(article, { section: "section-plan-a" });
  assert.equal(
    selected.body,
    body.slice(body.indexOf("## Plan *A*"), body.indexOf("## Plan A\r")),
  );
  assert.equal(selected.revision_id, article.revision_id);
  assert.equal(selected.partial, true);
  assert.equal(selected.url, "/wiki/guide/revision/2/#section-plan-a");
  assert.equal(
    selectArticle(article, { section: "" }).body,
    "Intro 🧭.\r\n\r\n",
  );
  assert.equal(
    selectArticle(article, { section: "section-résumé" }).body,
    "Résumé\r\n------\r\nLast.\r\n",
  );
  assert.throws(() => selectArticle(article, { section: "section-fake" }), {
    code: "UNKNOWN_ARTICLE_SECTION",
    status: 404,
  });
});
test("field reads retain revision identity and distinguish omitted bodies from empty bodies", () => {
  const compact = selectArticle(article, { fields: ["title", "sections"] });
  assert.equal(compact.body, undefined);
  assert.equal(compact.backlinks, undefined);
  assert.equal(compact.custom, undefined);
  assert.equal(compact.sections[2].anchor, "section-child");
  assert.equal(compact.sections[2].start, undefined);
  assert.equal(compact.number, 2);
  assert.equal(compact.url, "/wiki/guide/revision/2/");
  assert.equal(compact.partial, true);
  assert.deepEqual(
    selectArticle(article, { fields: ["custom"] }).custom,
    article.custom,
  );
  assert.equal(
    Object.hasOwn(selectArticle(article, { fields: ["toString"] }), "toString"),
    false,
  );
  assert.equal(
    selectArticle({ ...article, body: "" }, { section: "" }).body,
    "",
  );
  assert.equal(selectArticle(article, {}), article);
  assert.equal(article.body, body);
  assert.equal(article.partial, undefined);
});
test("selection parameters reject malformed and ambiguous queries", () => {
  assert.deepEqual(
    articleReadOptions(new URLSearchParams("section=&fields=title,body")),
    { section: "", fields: ["title", "body"] },
  );
  for (const query of [
    "fields=",
    "fields=title,,body",
    "fields=body.text",
    "fields=title&fields=body",
    "section=a&section=b",
    "fields=" + Array(33).fill("title").join(","),
  ])
    assert.throws(() => articleReadOptions(new URLSearchParams(query)), {
      code: "INVALID_ARTICLE_SELECTION",
      status: 400,
    });
});

test("a focused read omits unrelated bulk without truncating selected text", () => {
  const passage = "## Answer\nThe source says **42**. 🧭\n\n";
  const large = {
    ...article,
    body:
      "## Background\n" +
      "Background detail.\n".repeat(2000) +
      "\n" +
      passage +
      "## Appendix\n" +
      "Appendix detail.\n".repeat(2000),
  };
  const selected = selectArticle(large, {
    section: "section-answer",
    fields: ["body"],
  });
  assert.equal(selected.body, passage);
  assert.ok(
    JSON.stringify(selected).length < JSON.stringify(large).length / 100,
  );
  assert.equal(selectArticle(large, {}).body, large.body);
  const longHeading = "## " + "Long heading ".repeat(40) + "\nComplete.\n";
  const anchor = sections(longHeading)[1].anchor;
  const options = articleReadOptions(new URLSearchParams({ section: anchor }));
  assert.equal(
    selectArticle({ ...article, body: longHeading }, options).body,
    longHeading,
  );
});
