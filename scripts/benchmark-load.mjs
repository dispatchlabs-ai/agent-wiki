// Disposable authenticated load generator. Never accepts an existing wiki URL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { git, markdown } from "../src/git-wiki.mjs";

const here = fileURLToPath(import.meta.url);
const origin = "http://127.0.0.1";
const integer = (name, fallback, minimum = 0, maximum = Infinity) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw Error(`${name} must be an integer in ${minimum}..${maximum}`);
  return value;
};
const percentiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) =>
    sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return {
    count: sorted.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: sorted.at(-1) ?? null,
  };
};

async function serve(root) {
  const { ControlStore, secret } = await import("../src/control-store.mjs");
  const { AgentStore } = await import("../src/agent-store.mjs");
  const { RemoteAgents } = await import("../src/remote-agents.mjs");
  const { createWiki } = await import("../src/server.mjs");
  const control = new ControlStore(path.join(root, "control.sqlite3"));
  const owner = control.bootstrap({
    issuer: "benchmark",
    subject: "synthetic",
    name: "Synthetic owner",
  });
  const agents = new AgentStore(control);
  const agent = agents.create(owner, {
    name: "Synthetic load client",
    definition: {
      instructions: "Synthetic performance measurements",
      tools: ["wiki.read", "wiki.search", "wiki.save"],
    },
  });
  control.grant(owner, agent.id, "editor");
  const oauth = new RemoteAgents(agents, origin);
  const redirect = "http://127.0.0.1/callback";
  const client = oauth.register({
    client_name: "Synthetic benchmark",
    redirect_uris: [redirect],
  });
  const verifier = secret();
  const approved = new URL(
    oauth.approve(
      owner,
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirect,
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        resource: origin + "/mcp",
        scope: "wiki:read wiki:write",
        agent: agent.id,
        decision: "allow",
      }),
    ),
  );
  const credentials = oauth.exchange(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: redirect,
      code: approved.searchParams.get("code"),
      code_verifier: verifier,
    }),
  );
  const app = createWiki({
    repo: path.join(root, "content"),
    database: path.join(root, "index.sqlite3"),
    control,
    origin,
    write: true,
    push: false,
    conversations: false,
    traces: null,
    evidenceUrl: null,
    articleMediaRoot: null,
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let cpu, started, peakRss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss || 0, process.memoryUsage().rss);
  }, 100);
  process.on("message", ({ type }) => {
    if (type === "begin") {
      lag.reset();
      cpu = process.cpuUsage();
      started = performance.now();
      peakRss = process.memoryUsage().rss;
      process.send({ type: "begun" });
    } else if (type === "metrics") {
      const used = process.cpuUsage(cpu);
      process.send({
        type: "metrics",
        eventLoopP99Ms: lag.percentile(99) / 1e6,
        eventLoopMaxMs: lag.max / 1e6,
        sampledPeakRssMiB: peakRss / 2 ** 20,
        cpuCorePercent:
          (used.user + used.system) / ((performance.now() - started) * 10),
      });
    }
  });
  process.on("disconnect", () => {
    clearInterval(sampler);
    process.exit();
  });
  process.send({
    type: "ready",
    port: app.address().port,
    credentials,
    clientId: client.client_id,
  });
}

async function run() {
  const config = {
    readers: integer("BENCH_READERS", 48),
    writers: integer("BENCH_WRITERS", 8),
    seconds: integer("BENCH_SECONDS", 10, 1),
    articles: integer("BENCH_ARTICLES", 200, 1),
    bodyBytes: integer("BENCH_BODY_BYTES", 2048, 100, 45000),
    batch: integer("BENCH_BATCH", 1, 1, 10),
    timeoutMs: integer("BENCH_TIMEOUT_MS", 30000, 1),
    transport: process.env.BENCH_TRANSPORT || "mcp",
  };
  if (!config.readers && !config.writers)
    throw Error("Specify at least one reader or writer");
  if (!["mcp", "http"].includes(config.transport))
    throw Error("BENCH_TRANSPORT must be mcp or http");
  const root = fs.mkdtempSync(
    path.join(process.env.BENCH_TMPDIR || os.tmpdir(), "agent-wiki-load-"),
  );
  const repo = path.join(root, "content");
  let child, healthTimer;
  const sockets = new http.Agent({ keepAlive: true });
  const probes = new Set();
  const cleanup = async () => {
    clearInterval(healthTimer);
    sockets.destroy();
    if (child?.pid) {
      const exited =
        child.exitCode === null && child.signalCode === null
          ? once(child, "exit")
          : Promise.resolve();
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  };
  const interrupted = async () => {
    await cleanup();
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    // Ignore operator Git/Wiki configuration, including signing and hooks.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("WIKI_") && !key.startsWith("GIT_"),
      ),
    );
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      WIKI_CONVERSATIONS: "0",
    });
    const g = (args) => git(repo, args, { env });
    fs.mkdirSync(path.join(repo, "wiki"), { recursive: true });
    g(["init", "-b", "main"]);
    g(["config", "user.name", "Synthetic benchmark"]);
    g(["config", "user.email", "benchmark@example.invalid"]);
    const body = (label) =>
      `## Synthetic evidence\n\n${label}\n\n` +
      "Fictional sensor performance and prototype decisions.\n"
        .repeat(Math.ceil(config.bodyBytes / 53))
        .slice(0, config.bodyBytes) +
      "\n";
    const meta = (id) => ({
      title: id,
      description: "Synthetic load fixture",
      topic: "Benchmark",
    });
    const ids = Array.from(
      { length: config.articles },
      (_, i) => `article-${i}`,
    );
    const lanes = Array.from({ length: config.writers }, (_, i) =>
      Array.from({ length: config.batch }, (_, j) => `writer-${i}-${j}`),
    );
    for (const id of [...ids, ...lanes.flat(), "conflict-target"])
      fs.writeFileSync(
        path.join(repo, `wiki/${id}.md`),
        markdown(meta(id), body("Initial content")),
      );
    g(["add", "wiki"]);
    g(["commit", "-m", "Synthetic load fixture"]);
    const message = (type) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => done(Error(`Server IPC timeout: ${type}`)),
          60000,
        );
        const receive = (m) => {
          if (m.type === type) done(null, m);
        };
        const failed = (code) => done(Error(`Server exited: ${code}`));
        function done(error, value) {
          clearTimeout(timer);
          child.off("message", receive);
          child.off("exit", failed);
          child.off("error", done);
          error ? reject(error) : resolve(value);
        }
        child.on("message", receive);
        child.once("exit", failed);
        child.once("error", done);
      });
    child = fork(here, ["--serve", root], {
      env,
      detached: true,
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const ready = await message("ready");
    let credentials = ready.credentials,
      expires = Date.now() + credentials.expires_in * 1000,
      refreshing;
    const request = (
      route,
      payload,
      headers = {},
      timeoutMs = config.timeoutMs,
    ) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: ready.port,
            path: route,
            method: payload === undefined ? "GET" : "POST",
            agent: sockets,
            headers: { Host: "127.0.0.1", ...headers },
          },
          (res) => {
            const chunks = [];
            res.on("data", (b) => chunks.push(b));
            res.on("error", reject);
            res.on("end", () => {
              try {
                const raw = Buffer.concat(chunks).toString();
                const data = res.headers["content-type"]?.startsWith(
                  "text/event-stream",
                )
                  ? raw
                      .split(/\r?\n\r?\n/)
                      .map((event) =>
                        event
                          .split(/\r?\n/)
                          .filter((line) => line.startsWith("data:"))
                          .map((line) => line.slice(5).trimStart())
                          .join("\n"),
                      )
                      .filter(Boolean)
                      .map((value) => JSON.parse(value))
                      .find((value) => value.id !== undefined)
                  : JSON.parse(raw);
                if (!data)
                  throw Error("Missing JSON-RPC response in event stream");
                if (res.statusCode !== 200)
                  throw Object.assign(
                    Error(data.error || `HTTP ${res.statusCode}`),
                    { code: data.code || `HTTP_${res.statusCode}` },
                  );
                resolve(data);
              } catch (e) {
                reject(e);
              }
            });
          },
        );
        // Wall-clock deadline, including socket wait and body transfer.
        const timer = setTimeout(
          () =>
            req.destroy(
              Object.assign(Error("Request deadline"), { code: "TIMEOUT" }),
            ),
          timeoutMs,
        );
        req.on("close", () => clearTimeout(timer));
        req.on("error", reject);
        req.end(payload);
      });
    const token = async () => {
      if (Date.now() > expires - 30000) {
        refreshing ||= request(
          "/oauth/token",
          new URLSearchParams({
            grant_type: "refresh_token",
            client_id: ready.clientId,
            refresh_token: credentials.refresh_token,
          }).toString(),
          { "Content-Type": "application/x-www-form-urlencoded" },
        )
          .then((next) => {
            credentials = next;
            expires = Date.now() + next.expires_in * 1000;
          })
          .finally(() => {
            refreshing = null;
          });
        await refreshing;
      }
      return credentials.access_token;
    };
    let rpcId = 0;
    const call = async (name, args) => {
      const headers = {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Wiki-Write": "1",
      };
      if (config.transport === "http") {
        const route =
          name === "wiki.save"
            ? "/api/articles/edits"
            : name === "wiki.search"
              ? "/api/articles/search?" + new URLSearchParams(args)
              : `/api/articles/${args.id}/${args.revision || "current"}.json`;
        return request(
          route,
          name === "wiki.save" ? JSON.stringify(args) : undefined,
          headers,
        );
      }
      const result = await request(
        "/mcp",
        JSON.stringify({
          jsonrpc: "2.0",
          id: ++rpcId,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        headers,
      );
      if (result.error)
        throw Object.assign(Error(result.error.message), { code: "RPC_ERROR" });
      const data = JSON.parse(
        result.result.content.find((c) => c.type === "text").text,
      );
      if (result.result.isError)
        throw Object.assign(Error(data.error), {
          code: data.code || "TOOL_ERROR",
        });
      if (data.state === "resource")
        throw Error("Unexpected resource result; reduce fixture size");
      return data;
    };
    const samples = {},
      errors = {},
      receipts = [];
    const measure = async (name, fn) => {
      const start = performance.now();
      try {
        const value = await fn();
        (samples[name] ||= []).push(performance.now() - start);
        return value;
      } catch (e) {
        const key = `${name}:${e.code || e.name}`;
        errors[key] = (errors[key] || 0) + 1;
        (samples[name + "Failure"] ||= []).push(performance.now() - start);
        throw Object.assign(e, { measured: true });
      }
    };
    // Warm both routes before measuring. Setup and correctness reads are excluded.
    await call("wiki.read", { id: ids[0] });
    await call("wiki.search", { q: "sensor", limit: 10 });
    const begun = message("begun");
    child.send({ type: "begin" });
    await begun;
    const start = performance.now(),
      deadline = start + config.seconds * 1000;
    healthTimer = setInterval(() => {
      const p = measure("health", () =>
        request("/healthz", undefined, {}, 4000),
      )
        .catch(() => {})
        .finally(() => probes.delete(p));
      probes.add(p);
    }, 100);
    console.error(
      `Loading ${config.transport}: ${config.readers} readers + ${config.writers} writers, ${config.batch} article(s)/save, ${config.seconds}s admission window`,
    );
    await Promise.all([
      ...Array.from({ length: config.readers }, (_, reader) =>
        (async () => {
          for (let n = reader; performance.now() < deadline; n++) {
            try {
              await (n % 5 === 4
                ? measure("search", () =>
                    call("wiki.search", { q: "sensor", limit: 10 }),
                  )
                : measure("read", () =>
                    call("wiki.read", { id: ids[n % ids.length] }),
                  ));
            } catch {
              /* Count failures without hiding saturation. */
            }
          }
        })(),
      ),
      ...lanes.map((lane, writer) =>
        (async () => {
          for (let n = 0; performance.now() < deadline; n++) {
            try {
              const current = await Promise.all(
                lane.map((id) =>
                  measure("writeRead", () => call("wiki.read", { id })),
                ),
              );
              const draft = {
                operation_id: randomUUID(),
                updates: current.map((article) => ({
                  id: article.id,
                  expected_revision_id: article.revision_id,
                  ...meta(article.id),
                  body: body(`Writer ${writer}, operation ${n}`),
                  summary: "Synthetic performance update",
                })),
              };
              const receipt = await measure("save", async () => {
                const value = await call("wiki.save", draft);
                if (
                  !["saved", "already-saved"].includes(value.state) ||
                  value.publication !== "live"
                )
                  throw Error("Save was not published");
                return value;
              });
              receipts.push({ draft, receipt });
            } catch (e) {
              if (!e.measured) throw e;
            }
          }
        })(),
      ),
    ]);
    const elapsedSeconds = (performance.now() - start) / 1000;
    clearInterval(healthTimer);
    await Promise.all(probes);
    const metrics = message("metrics");
    child.send({ type: "metrics" });
    const server = await metrics;
    delete server.type;
    // Inspect every acknowledged historical revision, even after later updates.
    let verifiedArticles = 0;
    for (const { draft, receipt } of receipts) {
      if (receipt.articles.length !== draft.updates.length)
        throw Error("Incomplete batch receipt");
      for (const update of draft.updates) {
        const saved = receipt.articles.find((a) => a.id === update.id);
        const article = await call("wiki.read", {
          id: update.id,
          revision: saved.number,
        });
        if (
          article.body !== update.body ||
          article.revision_id !== saved.revision_id
        )
          throw Error(`Readback mismatch: ${update.id}`);
        verifiedArticles++;
      }
    }
    let retryVerified = false;
    if (receipts.length) {
      const { draft, receipt } = receipts[0];
      const head = g(["rev-parse", "HEAD"]),
        repeated = await call("wiki.save", draft);
      if (
        repeated.commit !== receipt.commit ||
        repeated.state !== "already-saved" ||
        g(["rev-parse", "HEAD"]) !== head
      )
        throw Error("Idempotent retry created a different commit");
      retryVerified = true;
    }
    const initial = await call("wiki.read", { id: "conflict-target" });
    const headBeforeConflict = g(["rev-parse", "HEAD"]);
    const collisions = await Promise.all(
      Array.from({ length: 4 }, (_, n) =>
        call("wiki.save", {
          operation_id: randomUUID(),
          updates: [
            {
              id: initial.id,
              expected_revision_id: initial.revision_id,
              ...meta(initial.id),
              body: body(`Contender ${n}`),
              summary: "Synthetic conflict check",
            },
          ],
        }).then(
          () => "saved",
          (e) => e.code,
        ),
      ),
    );
    if (
      collisions.filter((s) => s === "saved").length !== 1 ||
      collisions.filter((s) => s === "REVISION_CONFLICT").length !== 3
    )
      throw Error(`Unexpected conflict results: ${collisions}`);
    const winner = await call("wiki.read", { id: initial.id });
    if (
      winner.body !== body(`Contender ${collisions.indexOf("saved")}`) ||
      g(["rev-list", "--count", `${headBeforeConflict}..HEAD`]) !== "1" ||
      g(["status", "--porcelain"])
    )
      throw Error("Conflicting saves changed more than the winning revision");
    const operations = Object.fromEntries(
      Object.entries(samples).map(([name, values]) => [
        name,
        { ...percentiles(values), perSecond: values.length / elapsedSeconds },
      ]),
    );
    const result = {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      source: git(path.dirname(path.dirname(here)), ["rev-parse", "HEAD"]),
      articleLoaderSha256: createHash("sha256")
        .update(
          fs.readFileSync(new URL("../src/git-wiki.mjs", import.meta.url)),
        )
        .digest("hex"),
      config,
      fixtureArticles: ids.length + lanes.flat().length + 1,
      elapsedSeconds,
      drainSeconds: Math.max(0, elapsedSeconds - config.seconds),
      operations,
      errors,
      server,
      correctness: {
        acknowledgedSaves: receipts.length,
        verifiedArticles,
        retryVerified,
        conflictWinners: 1,
        rejectedStaleWrites: 3,
      },
      scope:
        "Synthetic OAuth-authenticated article traffic; independent client/server processes on one host. Fixed clients (closed loop), no measured retries. Throughput includes drain time; successful and failed latencies are separate. Server CPU/RSS excludes editor subprocesses. No proxy, remote pushes, conversations, or external evidence. Not a production capacity guarantee.",
    };
    console.log(JSON.stringify(result, null, 2));
    if (Object.keys(errors).length) process.exitCode = 1;
  } finally {
    await cleanup();
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
}

if (process.argv[2] === "--serve") await serve(process.argv[3]);
else await run();
