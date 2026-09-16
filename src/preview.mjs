import { Worker } from "node:worker_threads";
import { WikiError } from "./errors.mjs";

const failure = (code) =>
  new WikiError(
    code,
    {
      PREVIEW_BUSY: "Preview renderer is busy; retry shortly.",
      PREVIEW_TIMEOUT: "Preview took too long; simplify the draft and retry.",
      PREVIEW_TOO_LARGE: "Rendered preview exceeds 2 MiB; simplify the draft.",
      PREVIEW_FAILED:
        "Preview could not be rendered within its resource limits.",
      PREVIEW_CANCELLED: "Preview request was cancelled.",
      PREVIEW_CLOSED: "Preview renderer is closed.",
    }[code],
    code === "PREVIEW_TOO_LARGE" ? 413 : 503,
  );

/** A bounded, disposable worker pool for untrusted draft Markdown. */
export class PreviewRenderer {
  constructor({
    workers = 2,
    queue = 8,
    timeout = 5000,
    workerUrl = new URL("./preview-worker.mjs", import.meta.url),
  } = {}) {
    this.limit = workers;
    this.queueLimit = queue;
    this.timeout = timeout;
    this.workerUrl = workerUrl;
    this.queue = [];
    this.workers = new Map();
    this.closed = false;
  }

  /** @param {string} body @param {AbortSignal} [signal] @returns {Promise<string>} */
  render(body, signal) {
    if (this.closed) return Promise.reject(failure("PREVIEW_CLOSED"));
    if (signal?.aborted) return Promise.reject(failure("PREVIEW_CANCELLED"));
    if (this.workers.size >= this.limit && this.queue.length >= this.queueLimit)
      return Promise.reject(failure("PREVIEW_BUSY"));
    return new Promise((resolve, reject) => {
      const job = { body, worker: null, done: false, finish: null };
      const abort = () => job.finish(failure("PREVIEW_CANCELLED"));
      const timer = setTimeout(
        () => job.finish(failure("PREVIEW_TIMEOUT")),
        this.timeout,
      );
      job.finish = (error, html) => {
        if (job.done) return;
        job.done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        const index = this.queue.indexOf(job);
        if (index !== -1) this.queue.splice(index, 1);
        // Retain the occupied slot until exit, including while terminating it.
        if (job.worker) void job.worker.terminate();
        if (error) reject(error);
        else resolve(html);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  pump() {
    while (
      !this.closed &&
      this.workers.size < this.limit &&
      this.queue.length
    ) {
      const job = this.queue.shift();
      let worker;
      try {
        worker = new Worker(this.workerUrl, {
          workerData: { body: job.body, maxBytes: 2 * 1024 * 1024 },
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        });
      } catch {
        job.finish(failure("PREVIEW_FAILED"));
        continue;
      }
      job.worker = worker;
      this.workers.set(worker, job);
      worker.once("message", (result) => {
        if (typeof result?.html === "string") job.finish(null, result.html);
        else
          job.finish(
            failure(
              result?.code === "PREVIEW_TOO_LARGE"
                ? result.code
                : "PREVIEW_FAILED",
            ),
          );
      });
      worker.once("error", () => job.finish(failure("PREVIEW_FAILED")));
      worker.once("exit", () => {
        job.finish(failure("PREVIEW_FAILED"));
        this.workers.delete(worker);
        this.pump();
      });
    }
  }

  async close() {
    this.closed = true;
    for (const job of [...this.queue, ...this.workers.values()])
      job.finish(failure("PREVIEW_CLOSED"));
    await Promise.all(
      [...this.workers.keys()].map((worker) => worker.terminate()),
    );
  }
}
