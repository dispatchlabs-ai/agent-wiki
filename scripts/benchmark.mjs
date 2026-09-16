// Measures the derivative index alone: no Git/HTTP/rendering/model work.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { WikiSearch } from "../src/wiki-search.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-wiki-benchmark-"));
const index = new WikiSearch(path.join(root, "index.sqlite3"));
try {
  const count = 10000,
    pages = new Map();
  for (let i = 0; i < count; i++)
    pages.set(`article-${i}`, {
      id: `article-${i}`,
      blob: `blob-${i}`,
      title: `Company ${i}`,
      description: "Synthetic sensor company.",
      topic: "Examples",
      related: [],
      body: `An example company.\n\n## Product\nSoil sensor model ${i}.\n\n## People\nAn example team.\n\n## Market\nGreenhouse monitoring category ${i % 100}.\n\n## Notes\nFictional benchmark content.`,
    });
  const wiki = { head: "initial", pages };
  const initial = index.sync(wiki);
  pages.set("article-42", {
    ...pages.get("article-42"),
    blob: "changed",
    body: "Updated sensor article.",
  });
  wiki.head = "changed";
  const incremental = index.sync(wiki);
  const timings = [];
  for (let i = 0; i < 110; i++) {
    const start = performance.now();
    index.search(`sensor ${i % 100}`);
    if (i >= 10) timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        node: process.version,
        articles: count,
        initial,
        incremental,
        queries: timings.length,
        queryMedianMs: timings[49],
        queryP95Ms: timings[94],
        scope: "SQLite only; excludes Git refresh, HTTP and rendering",
      },
      null,
      2,
    ),
  );
} finally {
  index.close();
  fs.rmSync(root, { recursive: true, force: true });
}
