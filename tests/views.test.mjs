import test from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "../src/views.mjs";
import { sources, safeUrl, renderMarkdown } from "../src/render.mjs";
test("comparison retains both original bodies including repeated lines and large replacements", () => {
  for (const [before, after] of [
    ["", ""],
    ["a\na\nb\n", "a\nb\na\n"],
    ["old", "new"],
    ["same\nold\nend", "same\nnew\nend"],
    [Array(900).fill("a").join("\n"), Array(900).fill("b").join("\n")],
  ]) {
    const groups = diffLines(before, after);
    assert.equal(groups.flatMap((g) => g.before).join("\n"), before);
    assert.equal(groups.flatMap((g) => g.after).join("\n"), after);
  }
});
test("source view extracts real links and rejects active or network-path metadata URLs", () => {
  const result = sources({
    sources: [
      { url: "javascript:alert(1)", title: "bad" },
      { url: "//outside.invalid", title: "bad" },
      { url: "https://example.org/source", title: "Actual source" },
    ],
    body: "See [source](https://example.org/source), [record](/traces/abc/?page=1#line-3) and [reference][r].\n\n[r]: https://example.org/reference\n\n`[not a source](https://example.org/code)`",
  });
  assert.deepEqual(
    result.map((s) => s.url),
    [
      "https://example.org/source",
      "/traces/abc/?page=1#line-3",
      "https://example.org/reference",
    ],
  );
  assert.equal(safeUrl("?page=2"), "?page=2");
  assert.equal(safeUrl("/\\evil.invalid"), null);
});

test("header-only Markdown tables render without a body", async () => {
  assert.match(
    await renderMarkdown("| Name | Value |\n| --- | --- |"),
    /<table/,
  );
});
