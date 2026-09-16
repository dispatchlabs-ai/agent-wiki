import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { PreviewRenderer } from "../src/preview.mjs";
import { renderMarkdown } from "../src/render.mjs";

const workerUrl = new URL("./fixtures/preview-worker.mjs", import.meta.url);
const code = (expected) => (error) =>
  error.code === expected && error.status === 503;

test("preview workers preserve sanitized Markdown and reject amplified output", async (t) => {
  const renderer = new PreviewRenderer();
  t.after(() => renderer.close());
  const body =
    "# Heading\n\n**Safe** <script>alert(1)</script> [bad](javascript:alert(1))";
  assert.equal(await renderer.render(body), await renderMarkdown(body));
  const worker = new Worker(
    new URL("../src/preview-worker.mjs", import.meta.url),
    {
      workerData: { body: "x".repeat(100), maxBytes: 64 },
    },
  );
  t.after(() => worker.terminate());
  assert.deepEqual((await once(worker, "message"))[0], {
    code: "PREVIEW_TOO_LARGE",
  });
});

test("preview deadlines include queued work and excess work is rejected", async (t) => {
  const renderer = new PreviewRenderer({
    workers: 1,
    queue: 1,
    timeout: 100,
    workerUrl,
  });
  t.after(() => renderer.close());
  const running = assert.rejects(
    renderer.render("hang"),
    code("PREVIEW_TIMEOUT"),
  );
  const queued = assert.rejects(
    renderer.render("hang"),
    code("PREVIEW_TIMEOUT"),
  );
  await assert.rejects(renderer.render("overflow"), code("PREVIEW_BUSY"));
  await Promise.all([running, queued]);
  assert.equal(renderer.queue.length, 0);
  await renderer.close();
  assert.equal(renderer.workers.size, 0);
});

test("cancelled previews free queued and running capacity, and close rejects pending work", async (t) => {
  const renderer = new PreviewRenderer({ workers: 1, queue: 1, workerUrl });
  t.after(() => renderer.close());
  const runningController = new AbortController(),
    queuedController = new AbortController();
  const running = assert.rejects(
    renderer.render("hang", runningController.signal),
    code("PREVIEW_CANCELLED"),
  );
  const queued = assert.rejects(
    renderer.render("hang", queuedController.signal),
    code("PREVIEW_CANCELLED"),
  );
  queuedController.abort();
  await queued;
  assert.equal(renderer.queue.length, 0);
  const next = renderer.render("recovered");
  runningController.abort();
  await running;
  assert.equal(await next, "recovered");
  await assert.rejects(
    renderer.render("unused", runningController.signal),
    code("PREVIEW_CANCELLED"),
  );
  const active = assert.rejects(
    renderer.render("hang"),
    code("PREVIEW_CLOSED"),
  );
  await renderer.close();
  await active;
  assert.equal(renderer.workers.size, 0);
  await assert.rejects(renderer.render("unused"), code("PREVIEW_CLOSED"));
});

test("worker exceptions and early exits release preview capacity", async (t) => {
  const renderer = new PreviewRenderer({ workers: 1, workerUrl });
  t.after(() => renderer.close());
  for (const body of ["throw", "exit"]) {
    await assert.rejects(renderer.render(body), code("PREVIEW_FAILED"));
    assert.equal(await renderer.render("recovered"), "recovered");
  }
});
