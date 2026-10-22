import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { WikiError } from "./errors.mjs";

const now = () => performance.timeOrigin + performance.now();
const busy = () =>
  new WikiError(
    "WRITER_BUSY",
    "Writer queue timeout; retry the identical operation",
    503,
  );
const unavailable = () =>
  new WikiError(
    "WRITER_UNAVAILABLE",
    "Writer unavailable; retry the identical operation",
    503,
  );

// Service saves already require serial publication. Queue them in arrival order
// on one persistent worker instead of starting processes that race for the lock.
// The existing ten-second wait includes this queue and the filesystem lock;
// there is no additional concurrency/admission cap.
export class Writer {
  constructor(repo, options = {}) {
    this.config = { repo, options };
    this.worker = null;
    this.active = null;
    this.queue = [];
    this.closed = false;
    this.closing = null;
    this.finishClose = null;
  }

  save(draft, credentials = {}) {
    if (this.closed) return Promise.reject(unavailable());
    const input = structuredClone({ draft, credentials });
    return new Promise((resolve, reject) => {
      const request = {
        ...input,
        deadline: now() + 10000,
        resolve,
        reject,
        timer: null,
      };
      request.timer = setTimeout(() => {
        const index = this.queue.indexOf(request);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(busy());
      }, 10000);
      this.queue.push(request);
      this.next();
    });
  }

  next() {
    if (this.active) return;
    let request;
    while ((request = this.queue.shift())) {
      clearTimeout(request.timer);
      if (request.deadline > now()) break;
      request.reject(busy());
      request = null;
    }
    if (!request) {
      if (this.closed) {
        if (this.worker) {
          this.worker.ref();
          this.worker.postMessage({ kind: "close" });
        } else this.finishClose?.();
      } else this.worker?.unref();
      return;
    }
    this.active = request;
    try {
      if (!this.worker) this.start();
      this.worker.ref();
      this.worker.postMessage({
        kind: "save",
        draft: request.draft,
        credentials: request.credentials,
        deadline: request.deadline,
      });
    } catch (error) {
      this.active = null;
      request.reject(unavailable());
      this.next();
    }
  }

  start() {
    const worker = new Worker(new URL("./writer-worker.mjs", import.meta.url), {
      workerData: this.config,
    });
    this.worker = worker;
    worker.on("message", ({ receipt, error }) => {
      if (worker !== this.worker || !this.active) return;
      const request = this.active;
      this.active = null;
      if (error)
        request.reject(new WikiError(error.code, error.message, error.status));
      else request.resolve(receipt);
      this.next();
    });
    // Never start a replacement until the old worker has exited. An uncertain
    // save is returned to its caller for an identical-operation retry, not replayed.
    worker.on("error", () => {});
    worker.on("exit", () => {
      if (worker !== this.worker) return;
      this.worker = null;
      this.active?.reject(unavailable());
      this.active = null;
      this.next();
    });
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = new Promise((resolve) => {
      this.finishClose = resolve;
    });
    // Drain admitted saves and release the lock normally; termination could
    // interrupt publication or leave a stale filesystem lock behind.
    this.next();
    return this.closing;
  }
}
