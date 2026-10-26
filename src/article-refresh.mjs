import { Worker } from "node:worker_threads";

// Git, Markdown projection and SQLite publication must not block liveness or
// authentication. One reader owns this derived index; callers share its refresh.
export class ArticleRefresh {
  constructor(wiki, database) {
    this.wiki = wiki;
    this.database = database;
    this.worker = null;
    this.pending = new Map();
    this.closed = false;
  }

  refresh() {
    return this.request("refresh");
  }

  checkpoint() {
    return this.request("checkpoint");
  }

  async history(id, snapshot = this.wiki) {
    // Capture the serving revision before yielding. A concurrent refresh must
    // not change the requested history's numbering or article/commit identity.
    const refs = snapshot.histories.get(id) || [];
    if (
      refs.every((ref) =>
        this.wiki.attributions.has(snapshot.attributionKey(id, ref)),
      )
    )
      return this.wiki.history(id, refs);
    const result = await this.request("history", {
      id,
      refs,
      head: snapshot.head,
    });
    if (result.error) throw Error(result.error);
    for (const ref of result.revisions)
      this.wiki.attributions.set(
        snapshot.attributionKey(id, ref),
        ref.attribution,
      );
    return result.revisions;
  }

  request(kind, data = {}) {
    if (this.closed) return Promise.reject(Error("Article reader is closed"));
    const key = kind === "history" ? `${kind}:${data.head}:${data.id}` : kind;
    if (this.pending.has(key)) return this.pending.get(key).promise;
    if (!this.worker) {
      const worker = new Worker(
        new URL("./article-refresh-worker.mjs", import.meta.url),
        {
          workerData: { snapshot: { ...this.wiki }, database: this.database },
        },
      );
      this.worker = worker;
      worker.on("message", ({ key, result }) => {
        if (worker !== this.worker) return;
        const pending = this.pending.get(key);
        this.pending.delete(key);
        if (!this.pending.size) worker.unref();
        pending?.resolve(result);
      });
      const failed = (error) => {
        if (worker !== this.worker) return;
        this.worker = null;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        void worker.terminate();
      };
      worker.on("error", failed);
      worker.on("exit", () => failed(Error("Article refresh worker exited")));
    }
    const pending = { promise: null, resolve: null, reject: null };
    pending.promise = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    this.pending.set(key, pending);
    this.worker.ref();
    this.worker.postMessage({ kind, key, head: this.wiki.head, ...data });
    return pending.promise;
  }

  async close() {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    for (const pending of this.pending.values())
      pending.reject(Error("Article reader is closed"));
    this.pending.clear();
    await worker?.terminate();
  }
}
