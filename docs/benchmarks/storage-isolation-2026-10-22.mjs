// Synthetic storage experiment. Both parent directories must already exist.
// STORAGE_APP defaults to the repository containing this file. Never point the
// parents at an existing database: the experiment creates and removes its own
// uniquely named directories. It does not qualify persistent-storage recovery.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";

const app = path.resolve(
  process.env.STORAGE_APP || fileURLToPath(new URL("../../", import.meta.url)),
);
const parents = {
  local: process.env.STORAGE_LOCAL_PARENT,
  network: process.env.STORAGE_NETWORK_PARENT,
};
for (const [name, parent] of Object.entries(parents)) {
  if (!parent || !fs.statSync(parent).isDirectory())
    throw Error(`An existing STORAGE_${name.toUpperCase()}_PARENT is required`);
}
const smoke = process.env.STORAGE_SMOKE === "1";
const iterations = smoke ? 100 : 2000;
const rounds = ["local", "network", "network", "local"];
const log = (event, details = {}) =>
  console.log(
    JSON.stringify({ event, at: new Date().toISOString(), ...details }),
  );
const read = (filename) => {
  try {
    return fs.readFileSync(filename, "utf8");
  } catch {
    return null;
  }
};
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
  return {
    count: sorted.length,
    totalMs: samples.reduce((a, b) => a + b, 0),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: sorted.at(-1) ?? null,
  };
};
const measured = (samples, fn) => {
  const start = performance.now();
  const result = fn();
  samples.push(performance.now() - start);
  return result;
};
const cpuFiles = [
  "/sys/fs/cgroup/cpu.max",
  "/sys/fs/cgroup/cpu.stat",
  "/sys/fs/cgroup/cpu/cpu.stat",
  "/sys/fs/cgroup/cpu/cpu.cfs_quota_us",
  "/sys/fs/cgroup/cpu/cpu.cfs_period_us",
  "/sys/fs/cgroup/cpu,cpuacct/cpu.stat",
  "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us",
  "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us",
];
const cpu = () =>
  Object.fromEntries(
    cpuFiles.map((file) => [file, read(file)]).filter((x) => x[1]),
  );
function nfsCounters() {
  const body = read("/proc/self/mountstats");
  if (body === null) return null;
  const totals = {};
  let nfs = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("device ")) nfs = /fstype nfs/.test(line);
    const match = /^\s*([A-Z][A-Z0-9_]*):\s+(\d+)/.exec(line);
    if (nfs && match)
      totals[match[1]] = (totals[match[1]] || 0) + Number(match[2]);
  }
  return totals;
}
function delta(before, after) {
  if (before === null || after === null) return null;
  return Object.fromEntries(
    Object.entries(after).map(([key, value]) => [
      key,
      value - (before[key] || 0),
    ]),
  );
}
function filesystem(parent) {
  const value = fs.statfsSync(parent);
  return { typeHex: `0x${value.type.toString(16)}`, blockSize: value.bsize };
}

const storage = Object.fromEntries(
  Object.entries(parents).map(([name, parent]) => [
    name,
    fs.mkdtempSync(path.join(parent, "agent-wiki-storage-experiment-")),
  ]),
);
const code = fs.mkdtempSync(
  path.join(parents.local, "agent-wiki-storage-code-"),
);
let active;
let interrupted = false;
const stop = () => {
  interrupted = true;
  active?.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const source =
    process.env.STORAGE_SOURCE ||
    execFileSync("git", ["-C", app, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  const driver = fs.readFileSync(
    path.join(app, "scripts/benchmark-load.mjs"),
    "utf8",
  );
  log("plan", {
    source,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    smoke,
    logicalCpus: os.availableParallelism(),
    cpu: cpu(),
    filesystems: Object.fromEntries(
      Object.entries(storage).map(([name, root]) => [name, filesystem(root)]),
    ),
    sourceDriverSha256: createHash("sha256").update(driver).digest("hex"),
    micro: {
      order: rounds,
      readIterations: iterations,
      writeIterations: smoke ? 5 : 100,
    },
    load: {
      order: [
        "all-local",
        "all-network",
        "all-network",
        "all-local",
        "control-local",
        "control-network",
        "control-network",
        "control-local",
      ],
      seconds: smoke ? 1 : 60,
      readers: smoke ? 2 : 48,
      writers: smoke ? 1 : 8,
      articles: smoke ? 10 : 1000,
      bodyBytes: smoke ? 200 : 4096,
      requestTimeoutMs: 120000,
    },
  });
  for (const [round, medium] of rounds.entries()) {
    if (interrupted) throw Error("Interrupted");
    const root = fs.mkdtempSync(path.join(storage[medium], "sqlite-"));
    const filename = path.join(root, "probe.sqlite3");
    const db = new DatabaseSync(filename);
    let keeper;
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE probe(id INTEGER PRIMARY KEY, value INTEGER NOT NULL); BEGIN;",
      );
      const insert = db.prepare("INSERT INTO probe VALUES (?, 0)");
      for (let i = 0; i < 100; i++) insert.run(i);
      db.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE)");
      keeper = new DatabaseSync(filename);
      keeper.prepare("SELECT value FROM probe WHERE id=0").get();
      const query = db.prepare("SELECT value FROM probe WHERE id=?");
      for (let i = 0; i < 100; i++) query.get(i);
      const run = (label, fn) => {
        const before = nfsCounters();
        const beforeCpu = process.cpuUsage();
        const start = performance.now();
        const samples = fn();
        log("sqlite", {
          round,
          medium,
          label,
          elapsedMs: performance.now() - start,
          cpuMicros: process.cpuUsage(beforeCpu),
          phases: Object.fromEntries(
            Object.entries(samples).map(([key, value]) => [key, stats(value)]),
          ),
          nfsOperations: delta(before, nfsCounters()),
        });
      };
      run("autocommit-read", () => {
        const get = [];
        for (let i = 0; i < iterations; i++) {
          const result = measured(get, () => query.get(i % 100));
          if (result.value !== 0) throw Error("Unexpected synthetic read");
        }
        return { get };
      });
      run("short-read-transaction", () => {
        const begin = [],
          get = [],
          commit = [];
        for (let i = 0; i < iterations; i++) {
          measured(begin, () => db.exec("BEGIN"));
          const result = measured(get, () => query.get(i % 100));
          measured(commit, () => db.exec("COMMIT"));
          if (result.value !== 0) throw Error("Unexpected synthetic read");
        }
        return { begin, get, commit };
      });
      run("held-read-transaction", () => {
        const begin = [],
          firstGet = [],
          get = [],
          commit = [];
        measured(begin, () => db.exec("BEGIN"));
        measured(firstGet, () => query.get(0));
        for (let i = 0; i < iterations; i++) {
          const result = measured(get, () => query.get(i % 100));
          if (result.value !== 0) throw Error("Unexpected synthetic read");
        }
        measured(commit, () => db.exec("COMMIT"));
        return { begin, firstGet, get, commit };
      });
      const writes = smoke ? 5 : 100;
      const update = db.prepare("UPDATE probe SET value=value+1 WHERE id=?");
      run("durable-write", () => {
        const begin = [],
          updateMs = [],
          commit = [];
        for (let i = 0; i < writes; i++) {
          measured(begin, () => db.exec("BEGIN IMMEDIATE"));
          measured(updateMs, () => update.run(i % 100));
          measured(commit, () => db.exec("COMMIT"));
        }
        return { begin, update: updateMs, commit };
      });
      const journalMode = db.prepare("PRAGMA journal_mode").get().journal_mode;
      const synchronous = db.prepare("PRAGMA synchronous").get().synchronous;
      if (journalMode !== "wal" || synchronous !== 2)
        throw Error("Unexpected SQLite durability settings");
      keeper.close();
      keeper = undefined;
      db.close();
      const check = new DatabaseSync(filename);
      try {
        const sum = check
          .prepare("SELECT SUM(value) AS total FROM probe")
          .get().total;
        const integrity = check
          .prepare("PRAGMA integrity_check")
          .get().integrity_check;
        if (sum !== writes || integrity !== "ok")
          throw Error("SQLite readback failed");
        log("sqlite-verified", {
          round,
          medium,
          writes,
          sum,
          integrity,
          journalMode,
          synchronous,
        });
      } finally {
        check.close();
      }
    } finally {
      keeper?.close();
      if (db.isOpen) db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  fs.cpSync(path.join(app, "src"), path.join(code, "src"), { recursive: true });
  for (const name of ["node_modules", "public", "ui", "package.json"])
    fs.symlinkSync(path.join(app, name), path.join(code, name));
  fs.mkdirSync(path.join(code, "scripts"));
  let adapted = driver;
  for (const [before, after] of [
    [
      'path.join(root, "control.sqlite3")',
      'path.join(process.env.STORAGE_CONTROL_ROOT || root, "control.sqlite3")',
    ],
    [
      'source: git(path.dirname(path.dirname(here)), ["rev-parse", "HEAD"]),',
      "source: process.env.STORAGE_SOURCE,",
    ],
  ]) {
    if (adapted.split(before).length !== 2)
      throw Error("Benchmark adaptation must match exactly once");
    adapted = adapted.replace(before, after);
  }
  const runner = path.join(code, "scripts/benchmark-load.mjs");
  fs.writeFileSync(runner, adapted);
  log("adapted-driver", {
    sha256: createHash("sha256").update(adapted).digest("hex"),
  });
  const variants = {
    "all-local": { files: "local", control: "local" },
    "all-network": { files: "network", control: "network" },
    "control-local": { files: "network", control: "local" },
    "control-network": { files: "local", control: "network" },
  };
  const order = [
    "all-local",
    "all-network",
    "all-network",
    "all-local",
    "control-local",
    "control-network",
    "control-network",
    "control-local",
  ];
  let missingResults = 0;
  for (const [round, label] of order.entries()) {
    if (interrupted) throw Error("Interrupted");
    const placement = variants[label];
    const controlRoot = fs.mkdtempSync(
      path.join(storage[placement.control], "control-"),
    );
    const env = {
      ...process.env,
      BENCH_TMPDIR: storage[placement.files],
      STORAGE_CONTROL_ROOT: controlRoot,
      STORAGE_SOURCE: source,
      BENCH_READERS: smoke ? "2" : "48",
      BENCH_WRITERS: smoke ? "1" : "8",
      BENCH_SECONDS: smoke ? "1" : "60",
      BENCH_ARTICLES: smoke ? "10" : "1000",
      BENCH_BODY_BYTES: smoke ? "200" : "4096",
      BENCH_TIMEOUT_MS: "120000",
      BENCH_TRANSPORT: "mcp",
      BENCH_BATCH: "1",
      BENCH_WRITES_PER_WRITER: "0",
    };
    const nfsBefore = nfsCounters();
    const cpuBefore = cpu();
    log("load-begin", { round, label, placement });
    try {
      active = spawn(process.execPath, [runner], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        errors = "";
      active.stdout.on("data", (chunk) => {
        output += chunk;
      });
      active.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      const [exitCode, signal] = await once(active, "exit");
      active = undefined;
      let result = null;
      try {
        result = JSON.parse(output);
      } catch {}
      if (!result) missingResults++;
      log("load-result", {
        round,
        label,
        placement,
        exitCode,
        signal,
        result,
        errors: errors.slice(-4000),
        unparsed: result ? null : output.slice(-4000),
        nfsOperations: delta(nfsBefore, nfsCounters()),
        cpuBefore,
        cpuAfter: cpu(),
      });
    } finally {
      fs.rmSync(controlRoot, { recursive: true, force: true });
    }
  }
  log("completed", { loadRounds: order.length, missingResults });
  if (missingResults)
    throw Error(`${missingResults} load runs did not produce results`);
} finally {
  for (const root of Object.values(storage))
    fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(code, { recursive: true, force: true });
  log("cleanup", { storageRemoved: true, codeRemoved: true });
}
