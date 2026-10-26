import { Worker } from "node:worker_threads";
import { historyGit } from "./git-wiki.mjs";

// Git, Markdown projection and SQLite publication must not block liveness or
// authentication. One reader owns this derived index; callers share its refresh.
export class ArticleRefresh {
  constructor(wiki, database) {
    this.wiki = wiki;
    this.database = database;
    this.worker = null;
    this.pending = new Map();
    this.closed = false;
    this.stopping = null;
    this.closing = null;
    this.stopWorker = null;
  }

  refresh() {
    return this.request("refresh");
  }

  checkpoint() {
    return this.request("checkpoint");
  }

  async history(id, snapshot = this.wiki) {
    if (this.closed) throw Error("Article reader is closed");
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
    // Recovery cannot create a new owner until the previous worker's reads
    // have been terminated and reaped.
    if (this.stopping)
      return this.stopping.then(() => this.request(kind, data));
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
      const controller = new AbortController(),
        reads = new Set();
      const failed = (error) => {
        if (worker !== this.worker) return this.stopping;
        this.worker = null;
        const pending = [...this.pending.values()];
        this.pending.clear();
        controller.abort(error);
        const stopping = Promise.allSettled([
          worker.terminate(),
          ...reads,
        ]).then(() => {
          for (const request of pending) request.reject(error);
          if (this.stopping === stopping) this.stopping = null;
        });
        this.stopping = stopping;
        return stopping;
      };
      this.stopWorker = failed;
      worker.on(
        "message",
        ({ kind, requestId, args, options, key, result }) => {
          if (worker !== this.worker) return;
          if (kind === "historyGit") {
            // Spawn on the parent thread: worker termination cannot discard the
            // child handles or the promises that wait for their close events.
            const reply = (result) => {
              if (worker === this.worker)
                worker.postMessage({ kind, requestId, ...result });
            };
            const read = historyGit(this.wiki.repo, args, {
              ...options,
              signal: controller.signal,
            })
              .then(
                (output) => reply({ output }),
                (error) => reply({ error: error.message }),
              )
              .catch((error) => {
                void failed(error);
              })
              .finally(() => reads.delete(read));
            reads.add(read);
            return;
          }
          const pending = this.pending.get(key);
          this.pending.delete(key);
          if (!this.pending.size) worker.unref();
          pending?.resolve(result);
        },
      );
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
    try {
      this.worker.postMessage({ kind, key, head: this.wiki.head, ...data });
    } catch (error) {
      void this.stopWorker(error);
    }
    return pending.promise;
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.closing = this.worker
        ? this.stopWorker(Error("Article reader is closed"))
        : this.stopping || Promise.resolve();
    }
    return this.closing;
  }
}
