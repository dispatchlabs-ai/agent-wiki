import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WikiError } from "./errors.mjs";

const failure = (code, message, status = 503) =>
  new WikiError(code, message, status);

/** A bounded pool of killable processes for synchronous SQLite trace search. */
export class TraceSearchPool {
  constructor({
    workers = 2,
    queue = 8,
    childUrl = new URL("./trace-search-child.mjs", import.meta.url),
    forkProcess = fork,
  } = {}) {
    this.limit = workers;
    this.queueLimit = queue;
    this.childUrl = childUrl;
    this.forkProcess = forkProcess;
    this.queue = [];
    this.children = new Map();
    this.closed = false;
  }

  search(root, query, options, signal) {
    if (this.closed)
      return Promise.reject(failure("SEARCH_CLOSED", "Trace search is closed"));
    if (signal?.aborted)
      return Promise.reject(
        failure("SEARCH_CANCELLED", "Trace search was cancelled", 499),
      );
    if (
      this.children.size >= this.limit &&
      this.queue.length >= this.queueLimit
    )
      return Promise.reject(
        failure("SEARCH_BUSY", "Trace search is busy; retry shortly"),
      );
    return new Promise((resolve, reject) => {
      const job = {
        root,
        query,
        options,
        child: null,
        done: false,
        finish: null,
      };
      const abort = () =>
        job.finish(
          failure("SEARCH_CANCELLED", "Trace search was cancelled", 499),
        );
      job.finish = (error, result) => {
        if (job.done) return;
        job.done = true;
        signal?.removeEventListener("abort", abort);
        const index = this.queue.indexOf(job);
        if (index !== -1) this.queue.splice(index, 1);
        if (job.child) job.child.kill("SIGKILL");
        if (error) reject(error);
        else resolve(result);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  pump() {
    while (
      !this.closed &&
      this.children.size < this.limit &&
      this.queue.length
    ) {
      const job = this.queue.shift();
      let child;
      try {
        child = this.forkProcess(fileURLToPath(this.childUrl), [], {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
      } catch {
        job.finish(failure("SEARCH_UNAVAILABLE", "Trace search failed"));
        continue;
      }
      job.child = child;
      this.children.set(child, job);
      child.once("message", (message) => {
        const value = /** @type {any} */ (message);
        if (value?.ok) job.finish(null, value.result);
        else {
          const detail = value?.error || {};
          job.finish(
            failure(
              detail.code || "SEARCH_UNAVAILABLE",
              detail.message || "Trace search failed",
              detail.status || 503,
            ),
          );
        }
      });
      child.once("error", () =>
        job.finish(failure("SEARCH_UNAVAILABLE", "Trace search failed")),
      );
      // close follows both a normal exit and a spawn error, after all stdio is
      // closed. Retain the slot until then so native work cannot outlive it.
      child.once("close", () => {
        job.finish(failure("SEARCH_UNAVAILABLE", "Trace search failed"));
        this.children.delete(child);
        this.pump();
      });
      child.send(
        { root: job.root, query: job.query, options: job.options },
        (error) => {
          if (error)
            job.finish(failure("SEARCH_UNAVAILABLE", "Trace search failed"));
        },
      );
    }
  }

  async close() {
    this.closed = true;
    const exits = [...this.children.keys()].map(
      (child) =>
        new Promise((resolve) => {
          child.once("close", resolve);
        }),
    );
    for (const job of [...this.queue, ...this.children.values()])
      job.finish(failure("SEARCH_CLOSED", "Trace search is closed"));
    await Promise.all(exits);
  }
}
