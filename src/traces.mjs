// @ts-check
import {
  archiveStamp,
  recordImport,
  metadataCatalog,
} from "./trace-metadata.mjs";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WikiError } from "./errors.mjs";
import { Worker } from "node:worker_threads";
export const TRACE_VERSION = 1;
export const TRACE_PAGE_SIZE = 100;
import { inspectTrace } from "./trace-source.mjs";
export {
  digest,
  parseRecords,
  detectFormat,
  inspectTrace,
} from "./trace-source.mjs";
/** @returns {import("./contracts.mjs").TraceMetadata} */
export function importTrace(root, source, title) {
  const before = archiveStamp(root);
  fs.mkdirSync(root, { recursive: true });
  const temporary = path.join(root, `.import-${randomUUID()}`);
  fs.mkdirSync(temporary);
  let target;
  try {
    const copy = path.join(temporary, "source.jsonl");
    fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(copy, 0o444);
    const { id, format, bytes, records, session_id } = inspectTrace(copy);
    const metadata = {
      id,
      format,
      bytes,
      records,
      title: String(title || `${format} session`).slice(0, 300),
      session_id,
      imported_at: new Date().toISOString(),
    };
    target = path.join(root, id);
    if (fs.existsSync(target))
      return JSON.parse(
        fs.readFileSync(path.join(target, "metadata.json"), "utf8"),
      );
    fs.writeFileSync(
      path.join(temporary, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      if (!fs.existsSync(target)) throw error;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  const result = JSON.parse(
    fs.readFileSync(path.join(target, "metadata.json"), "utf8"),
  );
  recordImport(root, result, before);
  return result;
}
export class TraceStore {
  constructor(root, { maxBytes = 64 * 1024 * 1024, timeout = 0 } = {}) {
    this.root = root;
    this.maxBytes = maxBytes;
    this.timeout = timeout;
    this.cache = new Map();
    this.pending = new Map();
    this.queue = [];
    this.workers = new Set();
    this.bytes = 0;
    this.renders = 0;
    this.closed = false;
  }
  health() {
    if (!this.root) return { state: "disabled" };
    try {
      for (const id of fs
        .readdirSync(this.root)
        .filter((id) => /^[a-f0-9]{64}$/.test(id))) {
        if (
          !this.metadata(id) ||
          !fs.statSync(path.join(this.root, id, "source.jsonl")).isFile()
        )
          throw Error("Trace archive contains an unreadable snapshot");
      }
      return { state: "ready" };
    } catch (e) {
      return { state: "degraded", error: e.message };
    }
  }
  catalog() {
    return metadataCatalog(this.root);
  }
  catalogPage(options, grouped = false) {
    return metadataCatalog(this.root, options, grouped);
  }
  metadata(id) {
    if (!this.root || !/^[a-f0-9]{64}$/.test(id)) return null;
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(this.root, id, "metadata.json"), "utf8"),
      );
      if (value.id !== id || !["codex", "pi", "claude"].includes(value.format))
        return null;
      return { ...value, url: `/traces/${id}/` };
    } catch {
      return null;
    }
  }
  read(id, page = 1) {
    if (this.closed) return Promise.reject(new Error("Trace store closed"));
    if (!Number.isSafeInteger(page) || page < 1)
      return Promise.reject(new Error("Invalid trace page"));
    const metadata = this.metadata(id);
    if (!metadata) return Promise.resolve(null);
    if (
      Number.isSafeInteger(metadata.records) &&
      metadata.records > 0 &&
      page > Math.ceil(metadata.records / TRACE_PAGE_SIZE)
    )
      return Promise.resolve(null);
    return this.enqueue(metadata, { page });
  }
  readDisclosure(id, disclosure) {
    const metadata = this.metadata(id);
    return metadata
      ? this.enqueue(metadata, { disclosure })
      : Promise.resolve(null);
  }
  async readLines(id, start, end) {
    const result = await this.spoolLines(id, start, end);
    if (!result) return null;
    try {
      return JSON.parse(await fs.promises.readFile(result.path, "utf8"));
    } finally {
      await fs.promises.rm(result.directory, { recursive: true, force: true });
    }
  }
  spoolLines(id, start, end) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start
    )
      return Promise.reject(
        new WikiError(
          "INVALID_RANGE",
          "Request source lines with positive start and end, with end >= start",
        ),
      );
    const metadata = this.metadata(id);
    return metadata
      ? this.enqueue(metadata, { start, end })
      : Promise.resolve(null);
  }
  enqueue(metadata, selection) {
    if (this.closed) return Promise.reject(new Error("Trace store closed"));
    const key =
      selection.start !== undefined
        ? randomUUID()
        : `${TRACE_VERSION}:${metadata.id}:${JSON.stringify(selection)}`;
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return Promise.resolve(value.result);
    }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.queue.length >= 32)
      return Promise.reject(new Error("Trace renderer busy"));
    const promise = new Promise((resolve, reject) =>
      this.queue.push({ key, metadata, ...selection, resolve, reject }),
    );
    this.pending.set(key, promise);
    this.pump();
    return promise;
  }
  pump() {
    while (!this.closed && this.workers.size < 2 && this.queue.length) {
      const job = this.queue.shift();
      const directory =
        job.start !== undefined
          ? fs.mkdtempSync(path.join(os.tmpdir(), "wiki-trace-range-"))
          : undefined;
      /** @type {import("./contracts.mjs").WorkerRequest} */
      const request = {
        root: this.root,
        metadata: job.metadata,
        page: job.page,
        disclosure: job.disclosure,
        start: job.start,
        end: job.end,
        directory,
      };
      const worker = new Worker(
        new URL("./trace-worker.mjs", import.meta.url),
        {
          workerData: request,
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        },
      );
      this.workers.add(worker);
      if (job.page || job.disclosure) this.renders++;
      let finished = false;
      const finish = (error, result, size = 0) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.workers.delete(worker);
        this.pending.delete(job.key);
        void worker.terminate();
        if (directory && (error || !result))
          fs.rmSync(directory, { recursive: true, force: true });
        if (error) job.reject(error);
        else {
          if ((job.page || job.disclosure) && size <= this.maxBytes) {
            while (
              this.cache.size &&
              (this.bytes + size > this.maxBytes || this.cache.size >= 256)
            ) {
              const key = this.cache.keys().next().value;
              this.bytes -= this.cache.get(key).size;
              this.cache.delete(key);
            }
            this.cache.set(job.key, { result, size });
            this.bytes += size;
          }
          job.resolve(result);
        }
        this.pump();
      };
      // Full-source integrity reads take time proportional to source bytes and
      // storage throughput. A fixed deadline becomes an implicit file-size cap.
      const timer =
        this.timeout > 0
          ? setTimeout(
              () => finish(new Error("Trace rendering timed out")),
              this.timeout,
            )
          : undefined;
      worker.once(
        "message",
        (/** @type {import("./contracts.mjs").WorkerMessage} */ value) =>
          value.type === "error"
            ? finish(
                value.code
                  ? new WikiError(value.code, value.error, value.status)
                  : new Error(value.error),
              )
            : finish(null, value.result, value.size),
      );
      worker.once("error", (error) => finish(error));
      worker.once("exit", () => finish(new Error("Trace worker stopped")));
    }
  }
  close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      this.pending.delete(job.key);
      job.reject(new Error("Trace store closed"));
    }
    for (const worker of this.workers) void worker.terminate();
    this.cache.clear();
    this.bytes = 0;
  }
}
