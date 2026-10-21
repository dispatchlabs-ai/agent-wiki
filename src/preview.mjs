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

/** Reusable workers; failed, cancelled or timed-out jobs discard their worker. */
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
    if (
      this.workers.size >= this.limit &&
      [...this.workers.values()].every((job) => job !== null) &&
      this.queue.length >= this.queueLimit
    )
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
        // Failed workers retain their slot until exit. Successful workers keep
        // the expensive renderer imports warm for the next independent draft.
        if (job.worker) {
          if (error) void job.worker.terminate();
          else this.workers.set(job.worker, null);
        }
        if (error) reject(error);
        else resolve(html);
        this.pump();
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  pump() {
    while (!this.closed && this.queue.length) {
      let worker = [...this.workers].find(([, job]) => job === null)?.[0];
      if (!worker) {
        if (this.workers.size >= this.limit) return;
        try {
          worker = new Worker(this.workerUrl, {
            workerData: { maxBytes: 2 * 1024 * 1024 },
            resourceLimits: { maxOldGenerationSizeMb: 128 },
          });
        } catch {
          this.queue.shift().finish(failure("PREVIEW_FAILED"));
          continue;
        }
        this.workers.set(worker, null);
        worker.on("message", (result) => {
          const job = this.workers.get(worker);
          if (typeof result?.html === "string") job?.finish(null, result.html);
          else
            job?.finish(
              failure(
                result?.code === "PREVIEW_TOO_LARGE"
                  ? result.code
                  : "PREVIEW_FAILED",
              ),
            );
        });
        worker.once("error", () => {
          this.workers.get(worker)?.finish(failure("PREVIEW_FAILED"));
          void worker.terminate();
        });
        worker.once("exit", () => {
          this.workers.get(worker)?.finish(failure("PREVIEW_FAILED"));
          this.workers.delete(worker);
          this.pump();
        });
      }
      const job = this.queue.shift();
      job.worker = worker;
      this.workers.set(worker, job);
      worker.postMessage({ body: job.body });
    }
  }

  async close() {
    this.closed = true;
    for (const job of [...this.queue, ...this.workers.values()])
      job?.finish(failure("PREVIEW_CLOSED"));
    await Promise.all(
      [...this.workers.keys()].map((worker) => worker.terminate()),
    );
  }
}
