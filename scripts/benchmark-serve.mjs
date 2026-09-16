// Synthetic end-to-end measurements. No operator content or trace paths are used.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { git, markdown } from "../src/git-wiki.mjs";
import { createWiki } from "../src/server.mjs";
import { importTrace } from "../src/traces.mjs";
import { indexTraces } from "../src/trace-search.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-serving-benchmark-"));
const repo = path.join(root, "content"),
  traces = path.join(root, "traces");
const count = Number(process.env.BENCH_ARTICLES || 200);
const history = Number(process.env.BENCH_COMMITS || 50);
const records = Number(process.env.BENCH_RECORDS || 2000);
const snapshots = Number(process.env.BENCH_SNAPSHOTS || 100);
const delay = monitorEventLoopDelay({ resolution: 10 });
let app;
try {
  for (const n of [count, history, records, snapshots])
    if (!Number.isSafeInteger(n) || n < 1)
      throw Error("Benchmark sizes must be positive integers");
  fs.mkdirSync(path.join(repo, "wiki"), { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Benchmark"]);
  git(repo, ["config", "user.email", "benchmark@example.invalid"]);
  const page = (n) =>
    markdown(
      { title: "Article " + n, description: "Synthetic benchmark article" },
      "Soil sensors and prototype decisions.\n",
    );
  for (let i = 0; i < count; i++)
    fs.writeFileSync(path.join(repo, `wiki/article-${i}.md`), page(i));
  git(repo, ["add", "wiki"]);
  git(repo, ["commit", "-m", "Synthetic initial tree"]);
  const commit = (n) => {
    fs.writeFileSync(
      path.join(repo, "wiki/article-0.md"),
      page(0) + `Revision ${n}.\n`,
    );
    git(repo, ["add", "wiki/article-0.md"]);
    git(repo, ["commit", "-m", `Synthetic revision ${n}`]);
  };
  for (let i = 0; i < history; i++) commit(i);
  const source = path.join(root, "trace.jsonl");
  fs.writeFileSync(
    source,
    [
      { type: "session", id: "synthetic" },
      ...Array.from({ length: records }, (_, i) => ({
        type: "message",
        id: String(i),
        parentId: i ? String(i - 1) : null,
        message: { role: "user", content: "Prototype evidence. ".repeat(30) },
      })),
    ]
      .map(JSON.stringify)
      .join("\n"),
  );
  const trace = importTrace(traces, source, "Synthetic performance trace");
  const catalogSource = path.join(root, "catalog-source.jsonl");
  for (let i = 1; i < snapshots; i++) {
    fs.writeFileSync(
      catalogSource,
      JSON.stringify({ type: "session", id: `catalog-${i}` }) +
        "\n" +
        JSON.stringify({
          type: "message",
          id: "first",
          message: { role: "user", content: "Catalog benchmark evidence" },
        }),
    );
    importTrace(traces, catalogSource, `Catalog ${i}`);
  }
  indexTraces(traces);
  const start = performance.now();
  app = createWiki({
    repo,
    traces,
    database: path.join(root, "wiki.sqlite3"),
    origin: "http://wiki.benchmark",
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const startupMs = performance.now() - start;
  const request = (route) =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: app.address().port,
          path: route,
          headers: { Host: "wiki.benchmark" },
        },
        (res) => {
          res.resume();
          res.on("end", () =>
            res.statusCode === 200
              ? resolve(performance.now() - started)
              : reject(Error(`HTTP ${res.statusCode}`)),
          );
        },
      );
      req.on("error", reject);
    });
  delay.enable();
  const coldTraceMs = await request(`/traces/${trace.id}/`);
  const warmTraceMs = await request(`/traces/${trace.id}/`);
  const coldCatalogMs = await request("/api/traces/sessions.json?limit=20");
  const warmCatalogMs = await request("/api/traces/sessions.json?limit=20");
  const rangeMs = await request(
    `/api/traces/${trace.id}/lines.json?start=1&end=${records + 1}`,
  );
  const searchMs = await request("/api/traces/search?q=prototype");
  const samples = [];
  for (let i = 0; i < 10; i++) {
    commit(history + i);
    samples.push(
      ...(await Promise.all(
        Array.from({ length: 4 }, () => request("/wiki/article-0/")),
      )),
    );
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        node: process.version,
        articles: count,
        historyCommits: history + 1,
        traceRecords: records + 1,
        snapshots,
        coldCatalogMs,
        warmCatalogMs,
        rangeMs,
        peakRssMiB: process.resourceUsage().maxRSS / 1024,
        traceBytes: fs.statSync(source).size,
        startupMs,
        coldTraceMs,
        warmTraceMs,
        traceSearchMs: searchMs,
        readers: 4,
        editBatches: 10,
        readMedianMs: samples[19],
        readP95Ms: samples[37],
        eventLoopP99Ms: delay.percentile(99) / 1e6,
        sampledRssMiB: process.memoryUsage().rss / 1024 / 1024,
        scope:
          "Same-process HTTP client/server; includes Git refresh and rendering. Peak RSS is process-lifetime OS high-water RSS, including fixture setup and workers; sampled RSS is also reported. Synthetic fixtures; not a capacity guarantee.",
      },
      null,
      2,
    ),
  );
} finally {
  delay.disable();
  if (app)
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
  fs.rmSync(root, { recursive: true, force: true });
}
