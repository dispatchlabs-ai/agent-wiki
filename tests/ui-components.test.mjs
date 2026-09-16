import test from "node:test";
import assert from "node:assert/strict";
import { evidenceCatalog } from "../src/evidence-views.mjs";

test("conversation components escape evidence and preserve filtered pagination", () => {
  const html = evidenceCatalog(
    new URLSearchParams("q=hello&machine=fixture&format=pi&offset=20"),
    {
      total: 41,
      nextOffset: 40,
      items: [
        {
          id: "synthetic",
          title: '<script>alert("x")</script>',
          url: "javascript:alert(1)",
          machine: "fixture",
          format: "pi",
          start: null,
          end: null,
        },
      ],
    },
  );
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Last activity/);
  assert.match(html, /Unavailable/);
  assert.match(html, /q=hello&amp;format=pi&amp;machine=fixture&amp;offset=40/);
  assert.match(html, /rel="prev"/);
  assert.match(html, /rel="next"/);
});
