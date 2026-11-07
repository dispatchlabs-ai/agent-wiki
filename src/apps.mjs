import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appOperations } from "../public/apps-contract.js";
import { WikiError } from "./errors.mjs";
import { escape, link, shell } from "./render.mjs";
import { lifecycleLockFd } from "./lifecycle-lock.mjs";

const sdk = fs.readFileSync(new URL("../public/wiki-app.js", import.meta.url));
const unavailable = () =>
  new WikiError(
    "APPS_UNAVAILABLE",
    "Application storage is unavailable; retry mutations with the same operation_id.",
    503,
  );
const routes = appOperations.map((op) => ({
  ...op,
  match: new RegExp(
    "^" + op.path.replace("{id}", "([a-z0-9]+(?:-[a-z0-9]+)*)") + "$",
  ),
}));

/** One separate service process owns registered databases and page artifacts.
 * Only trusted storage code executes here; published JavaScript runs in the browser.
 */
export class Apps {
  constructor(root, { origin, excluded = [] }) {
    this.origin = origin;
    this.root = root ? path.resolve(root) : null;
    this.pending = new Map();
    this.leases = new Map();
    this.worker = null;
    this.active = null;
    this.stopping = false;
    this.sequence = 0;
    this.closed = false;
    if (this.root) {
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      this.root = fs.realpathSync(this.root);
      for (const filename of excluded.filter(Boolean)) {
        if (filename === ":memory:") continue;
        const other = fs.existsSync(filename)
          ? fs.realpathSync(filename)
          : path.resolve(filename);
        if (
          other === this.root ||
          other.startsWith(this.root + path.sep) ||
          this.root.startsWith(other + path.sep)
        )
          throw Error(
            "Application storage must be separate from wiki content, control and indexes",
          );
      }
    }
    this.sweep = setInterval(() => {
      for (const [key, lease] of this.leases) {
        try {
          lease.authorize();
        } catch {
          this.leases.delete(key);
        }
      }
    }, 60000);
    this.sweep.unref();
  }
  start() {
    if (!this.root)
      throw new WikiError(
        "APPS_DISABLED",
        "Configure WIKI_APPS to enable hosted pages and isolated backend storage.",
        503,
      );
    if (this.closed) throw unavailable();
    if (this.worker) return this.worker;
    const fence = lifecycleLockFd();
    const worker = fork(
      fileURLToPath(new URL("./apps-worker.mjs", import.meta.url)),
      [this.root],
      {
        cwd: this.root,
        // Never pass wiki secrets, runtime flags or database paths into app storage.
        env: { LANG: "C", NODE_NO_WARNINGS: "1" },
        execArgv: [],
        serialization: "advanced",
        stdio: [
          "ignore",
          "ignore",
          "inherit",
          "ipc",
          ...(fence === null ? [] : [fence]),
        ],
      },
    );
    this.worker = worker;
    const failed = () => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.stopping = false;
      const task = this.pending.get(this.active);
      this.active = null;
      if (task) task.finish(unavailable());
      else this.pump();
    };
    worker.on("error", failed);
    worker.on("exit", failed);
    worker.on(
      "message",
      /** @param {any} message */ (message) => {
        if (message.authorize !== undefined) {
          const task = this.pending.get(message.authorize);
          let error;
          try {
            if (!task) throw unavailable();
            task.authorize();
          } catch (e) {
            error = {
              message: e.message,
              code: e.code || "APP_FORBIDDEN",
              status: e.status || 403,
            };
          }
          if (worker.connected)
            worker.send({ authorized: message.authorize, error }, () => {});
          return;
        }
        const task = this.pending.get(message.request);
        if (!task) return;
        if (message.error)
          task.finish(
            new WikiError(
              message.error.code,
              message.error.message,
              message.error.status,
            ),
          );
        else {
          try {
            task.authorize();
            task.finish(null, message.result);
          } catch (error) {
            task.finish(error);
          }
        }
      },
    );
    return worker;
  }
  request(op, args, actor, authorize, signal = null) {
    authorize();
    if (signal?.aborted)
      return Promise.reject(
        new WikiError("APP_CANCELLED", "Request cancelled", 499),
      );
    this.start();
    return new Promise((resolve, reject) => {
      const request = ++this.sequence;
      let finished = false;
      const abort = () => {
        // Queued cancellation belongs only to that request. Interrupting active
        // SQLite retires its process; undispatched work resumes on the next one.
        if (this.active === request) {
          this.stopping = true;
          this.worker?.kill();
        }
        finish(
          new WikiError(
            "APP_CANCELLED",
            "Request cancelled; retry mutations with the same operation_id.",
            499,
          ),
        );
      };
      const finish = (error, result = undefined) => {
        if (finished) return;
        finished = true;
        this.pending.delete(request);
        if (this.active === request) this.active = null;
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(result);
        this.pump();
      };
      this.pending.set(request, {
        authorize,
        finish,
        message: { request, op, args, actor },
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.pump();
    });
  }
  pump() {
    if (
      this.closed ||
      this.stopping ||
      this.active !== null ||
      !this.pending.size
    )
      return;
    const [request, task] = this.pending.entries().next().value;
    try {
      task.authorize();
      const worker = this.start();
      this.active = request;
      worker.send(task.message, (error) => {
        if (error) {
          this.stopping = true;
          worker.kill();
          task.finish(unavailable());
        }
      });
    } catch (error) {
      task.finish(error);
    }
  }
  async asset(req, res, url) {
    if (!url.pathname.startsWith("/_app-assets/")) return false;
    const match = url.pathname.match(/^\/_app-assets\/([a-f0-9]{64})\/(.+)$/);
    const lease = match && this.leases.get(match[1]);
    if (!lease || req.method !== "GET")
      throw new WikiError("NOT_FOUND", "Not found", 404);
    lease.authorize();
    const filename = decodeURIComponent(match[2]);
    const file =
      path.posix.basename(filename) === "wiki-app.js"
        ? { type: "text/javascript", content: sdk.toString("base64") }
        : await this.request(
            "pageAsset",
            { id: lease.id, revision: lease.revision, path: filename },
            lease.actor,
            lease.authorize,
          );
    lease.authorize();
    const source = `${this.origin}/_app-assets/${match[1]}/`;
    res.writeHead(200, {
      "Content-Type":
        file.type + (file.type.startsWith("text/") ? "; charset=utf-8" : ""),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${source}; style-src 'unsafe-inline' ${source}; img-src data: blob: ${source}; font-src data: ${source}; media-src blob: ${source}; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${this.origin}`,
    });
    res.end(Buffer.from(file.content, "base64"));
    return true;
  }
  async handle({ req, url, actor, authorize, send, signal, csrf = "" }) {
    const selected = routes.find((op) => op.match.test(url.pathname));
    if (selected) {
      if (req.method.toLowerCase() !== selected.method)
        throw new WikiError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
      const check = () => authorize(selected.write ? "write" : "read");
      check();
      let args = {};
      if (selected.method === "post") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json")
          throw new WikiError("INVALID_APP", "JSON required", 400);
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try {
          args = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
        } catch {
          throw new WikiError("INVALID_APP", "Invalid JSON", 400);
        }
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new WikiError("INVALID_APP", "Expected an object", 400);
      }
      const id = selected.match.exec(url.pathname)[1];
      if (id) {
        if (args.id !== undefined && args.id !== id)
          throw new WikiError(
            "INVALID_APP",
            "Backend/page ID does not match route",
            400,
          );
        args.id = id;
      }
      if (selected.method === "get" && url.searchParams.has("revision"))
        args.revision = url.searchParams.get("revision");
      for (const key of selected.inputSchema.required)
        if (!(key in args))
          throw new WikiError("INVALID_APP", `${key} is required`, 400);
      for (const key of Object.keys(args))
        if (!(key in selected.inputSchema.properties))
          throw new WikiError("INVALID_APP", `Unknown field: ${key}`, 400);
      const result = await this.request(
        selected.name.slice("wiki.".length),
        args,
        actor,
        check,
        signal,
      );
      send(200, result);
      return true;
    }
    const match = url.pathname.match(
      /^\/apps\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([a-f0-9]{64}))?\/$/,
    );
    if (!match) return false;
    if (req.method !== "GET")
      throw new WikiError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    const check = () => authorize("read");
    const page = await this.request(
      "pageView",
      { id: match[1], revision: match[2] },
      actor,
      check,
      signal,
    );
    const lease = randomBytes(32).toString("hex");
    this.leases.set(lease, {
      id: page.id,
      revision: page.revision,
      actor,
      authorize: check,
    });
    const config = {
      backend: page.backend_id,
      write: page.backend_access === "write",
      articles: page.articles,
      csrf,
      capability: lease,
    };
    send(
      200,
      shell(
        page.title,
        `<h1>${escape(page.title)}</h1><p class="lede">${escape(page.description)}</p><nav class="actions">${page.articles.map((id) => link(`/wiki/${id}/`, id)).join(" ")}${link(page.revision_url, "Link to this version")}</nav><iframe class="hosted-app" title="${escape(page.title)}" sandbox="allow-scripts" data-src="/_app-assets/${lease}/${escape(page.entrypoint)}" data-wiki-app="${escape(JSON.stringify(config))}"></iframe><script src="/assets/app-host.js" defer></script>`,
      ),
      "text/html",
    );
    return true;
  }
  async close() {
    this.closed = true;
    clearInterval(this.sweep);
    this.leases.clear();
    for (const task of this.pending.values()) task.finish(unavailable());
    if (!this.worker) return;
    const worker = this.worker;
    await new Promise((resolve) => {
      worker.once("exit", resolve);
      worker.kill();
    });
  }
}
