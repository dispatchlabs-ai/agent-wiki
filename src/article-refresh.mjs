import { Worker } from "node:worker_threads";

// Git, Markdown projection and SQLite publication must not block liveness or
// authentication. One reader owns this derived index; callers share its refresh.
export class ArticleRefresh {
  constructor(wiki, database) {
    this.wiki = wiki;
    this.database = database;
    this.worker = null;
    this.pending = null;
    this.closed = false;
  }

  refresh() {
    return this.request("refresh");
  }

  checkpoint() {
    return this.request("checkpoint");
  }

  request(kind) {
    if (this.closed) return Promise.reject(Error("Article reader is closed"));
    if (this.pending)
      return this.pending.kind === kind
        ? this.pending.promise
        : this.pending.promise.then(() => this.request(kind));
    if (!this.worker) {
      const worker = new Worker(
        new URL("./article-refresh-worker.mjs", import.meta.url),
        {
          workerData: { snapshot: { ...this.wiki }, database: this.database },
        },
      );
      this.worker = worker;
      worker.on("message", (result) => {
        if (worker !== this.worker) return;
        const pending = this.pending;
        this.pending = null;
        worker.unref();
        pending?.resolve(result);
      });
      const failed = (error) => {
        if (worker !== this.worker) return;
        this.worker = null;
        const pending = this.pending;
        this.pending = null;
        pending?.reject(error);
        void worker.terminate();
      };
      worker.on("error", failed);
      worker.on("exit", () => failed(Error("Article refresh worker exited")));
    }
    const pending = { kind, promise: null, resolve: null, reject: null };
    pending.promise = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    this.pending = pending;
    this.worker.ref();
    this.worker.postMessage({ kind, head: this.wiki.head });
    return pending.promise;
  }

  async close() {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    this.pending?.reject(Error("Article reader is closed"));
    this.pending = null;
    await worker?.terminate();
  }
}
