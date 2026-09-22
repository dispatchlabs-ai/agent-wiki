import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const source = fileURLToPath(new URL("..", import.meta.url));
const lifecycle = path.join(source, "scripts/lifecycle.py");
const editor = path.join(source, "src/editor.mjs");
const python = process.env.PYTHON || "python3";

function temporary(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-wiki-lifecycle-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function call(args, options = {}) {
  return spawnSync(python, [lifecycle, ...args], {
    cwd: source,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: "utf8",
  });
}

function bootstrap(root, overrides = {}) {
  return call([
    "bootstrap",
    "--root",
    root,
    "--origin",
    "https://wiki.example.test",
    "--manager-email",
    overrides.email || "manager@example.test",
    "--manager-name",
    overrides.name || "Manager",
  ]);
}

function adopt(root, overrides = {}) {
  const args = [
    "adopt",
    "--root",
    root,
    "--origin",
    overrides.origin || "https://wiki.example.test",
  ];
  if (overrides.evidence)
    args.push("--external-evidence-url", overrides.evidence);
  return call(args, { env: overrides.env });
}

function savedDraft(operation, id) {
  return JSON.stringify({
    operation_id: operation,
    updates: [
      {
        id,
        expected_revision_id: null,
        title: "Lifecycle test",
        description: "Synthetic recovery verification",
        topic: "Tests",
        body: "The recovered installation remains writable.\n",
        summary: "Verify lifecycle recovery",
      },
    ],
  });
}

function sha256(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

async function waitFor(check, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error(message);
}

test("bootstrap commits marker last and refuses rebootstrap or partial state", (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  const created = bootstrap(root);
  assert.equal(created.status, 0, created.stderr);
  const receipt = JSON.parse(created.stdout);
  assert.equal(receipt.state, "initialized");
  assert.match(
    receipt.setup_url,
    /^https:\/\/wiki\.example\.test\/auth\/local\/setup#/,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, ".lifecycle/initialized.json")))
      .content_head,
    execFileSync(
      "git",
      ["-C", path.join(root, "content"), "rev-parse", "HEAD"],
      {
        encoding: "utf8",
      },
    ).trim(),
  );
  const repeated = bootstrap(root, { email: "other@example.test" });
  assert.equal(repeated.status, 3);
  assert.equal(JSON.parse(repeated.stderr).code, "ALREADY_INITIALIZED");

  const partial = path.join(directory, "partial");
  const failed = bootstrap(partial, { email: "not-an-email" });
  assert.notEqual(failed.status, 0);
  assert.equal(
    fs.existsSync(path.join(partial, ".lifecycle/initialized.json")),
    false,
  );
  const retry = bootstrap(partial);
  assert.equal(retry.status, 3);
  assert.equal(JSON.parse(retry.stderr).code, "PARTIAL_STATE");
});

test("adopt preserves existing state, accepts safe SSH aliases, and records external evidence", (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  fs.rmSync(path.join(root, ".lifecycle/initialized.json"));
  fs.rmSync(path.join(root, "traces"), { recursive: true });
  fs.rmSync(path.join(root, "article-media"), { recursive: true });
  execFileSync("git", [
    "-C",
    path.join(root, "content"),
    "remote",
    "add",
    "origin",
    "wiki-host:/srv/private/agent-wiki-content.git",
  ]);
  const control = path.join(root, "control/control.sqlite3");
  const beforeControl = sha256(control);
  const beforeHead = execFileSync(
    "git",
    ["-C", path.join(root, "content"), "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const contentInode = fs.statSync(path.join(root, "content")).ino;
  const interruptedMarker = path.join(
    root,
    ".lifecycle/.initialized.json.0123456789abcdef0123456789abcdef.tmp",
  );
  fs.writeFileSync(interruptedMarker, "incomplete");

  const result = adopt(root, {
    evidence: "http://127.0.0.1:8769/api/evidence/v1",
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.state, "adopted");
  assert.equal(receipt.content_head, beforeHead);
  assert.deepEqual(receipt.evidence, {
    mode: "external",
    url: "http://127.0.0.1:8769/api/evidence/v1/",
  });
  assert.equal(fs.statSync(path.join(root, "content")).ino, contentInode);
  assert.equal(sha256(control), beforeControl);
  assert.equal(fs.existsSync(interruptedMarker), false);
  assert.equal(fs.existsSync(path.join(root, "traces")), false);
  assert.equal(
    fs.statSync(path.join(root, "article-media")).isDirectory(),
    true,
  );

  const environment = call(
    [
      "maintenance",
      "--root",
      root,
      "--",
      process.execPath,
      "-e",
      "console.log(JSON.stringify({traces:process.env.WIKI_TRACES||null,evidence:process.env.WIKI_EVIDENCE_URL,push:process.env.WIKI_PUSH,askpass:process.env.GIT_ASKPASS,author:process.env.GIT_AUTHOR_EMAIL,committer:process.env.GIT_COMMITTER_EMAIL}))",
    ],
    {
      env: {
        WIKI_TRACES: "/wrong/local/traces",
        WIKI_EVIDENCE_URL: "https://wrong.example/",
        WIKI_PUSH: "1",
        GIT_ASKPASS: "/explicit/askpass",
        GIT_AUTHOR_EMAIL: "wiki-author@example.test",
        GIT_COMMITTER_EMAIL: "wiki-committer@example.test",
      },
    },
  );
  assert.equal(environment.status, 0, environment.stderr);
  assert.deepEqual(JSON.parse(environment.stdout), {
    traces: null,
    evidence: "http://127.0.0.1:8769/api/evidence/v1/",
    push: "1",
    askpass: "/explicit/askpass",
    author: "wiki-author@example.test",
    committer: "wiki-committer@example.test",
  });

  const repeated = adopt(root, {
    evidence: "http://127.0.0.1:8769/api/evidence/v1/",
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).state, "already-adopted");
  const mismatch = adopt(root);
  assert.equal(mismatch.status, 3);
  assert.equal(JSON.parse(mismatch.stderr).code, "ALREADY_INITIALIZED");

  const archive = path.join(directory, "external-backup.tar.gz");
  const backedUp = call(["backup", "--root", root, "--destination", archive]);
  assert.equal(backedUp.status, 0, backedUp.stderr);
  assert.equal(JSON.parse(backedUp.stdout).evidence.mode, "external");
  const listing = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
  }).split("\n");
  assert.equal(
    listing.some((name) => name === "traces" || name.startsWith("traces/")),
    false,
  );

  const restored = path.join(directory, "restored");
  const restore = call(["restore", "--root", restored, "--archive", archive]);
  assert.equal(restore.status, 0, restore.stderr);
  assert.deepEqual(JSON.parse(restore.stdout).evidence, receipt.evidence);
  assert.equal(fs.existsSync(path.join(restored, "traces")), false);
  assert.equal(
    JSON.parse(call(["status", "--root", restored]).stdout).evidence.mode,
    "external",
  );
});

test("adopt rejects unsafe Git helpers and ambiguous local evidence", (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  fs.rmSync(path.join(root, ".lifecycle/initialized.json"));
  execFileSync("git", [
    "-C",
    path.join(root, "content"),
    "remote",
    "add",
    "origin",
    "ext::sh -c unsafe",
  ]);
  let result = adopt(root);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).code, "UNSAFE_GIT_CONFIG");

  execFileSync("git", [
    "-C",
    path.join(root, "content"),
    "remote",
    "set-url",
    "origin",
    "wiki-host:/srv/wiki.git;touch-unsafe",
  ]);
  result = adopt(root);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).code, "UNSAFE_GIT_CONFIG");

  execFileSync("git", [
    "-C",
    path.join(root, "content"),
    "remote",
    "set-url",
    "origin",
    "ssh://wiki-host/srv/wiki.git;touch-unsafe",
  ]);
  result = adopt(root);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).code, "UNSAFE_GIT_CONFIG");

  execFileSync("git", [
    "-C",
    path.join(root, "content"),
    "remote",
    "set-url",
    "origin",
    "wiki-host:repositories/wiki.git",
  ]);
  fs.writeFileSync(path.join(root, "traces/evidence.jsonl"), "synthetic\n");
  result = adopt(root, { evidence: "http://127.0.0.1:8769/api/evidence/v1" });
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stderr).code, "EVIDENCE_CONFLICT");
});

test("adopt retries after interrupted diagnostic owner metadata replacement", (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  fs.rmSync(path.join(root, ".lifecycle/initialized.json"));
  const result = spawnSync(
    python,
    [path.join(source, "tests/fixtures/fault-owner-write.py"), lifecycle, root],
    { cwd: source, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(outcome.first, 1);
  assert.equal(outcome.leftovers.length, 1);
  assert.match(outcome.leftovers[0], /^\.owner\.json\.[a-f0-9]{32}\.tmp$/);
  assert.equal(outcome.second, 0);
  assert.deepEqual(outcome.remaining, []);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, ".lifecycle/initialized.json")))
      .origin,
    "https://wiki.example.test",
  );

  const unsafe = path.join(
    root,
    ".lifecycle/.owner.json.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tmp",
  );
  fs.symlinkSync(path.join(directory, "outside"), unsafe);
  const rejected = adopt(root);
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stderr).code, "INVALID_LOCK");
  assert.equal(fs.lstatSync(unsafe).isSymbolicLink(), true);
});

test("managed serve excludes maintenance and an explicit container bind is reachable", async (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  const reservation = http.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(
    python,
    [
      lifecycle,
      "serve",
      "--root",
      root,
      "--bind",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    {
      cwd: source,
      env: {
        ...process.env,
        WIKI_LOCAL_LOGIN: "1",
        WIKI_WRITE: "1",
        WIKI_PUSH: "0",
        WIKI_DATABASE: ":memory:",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => child.kill("SIGKILL"));
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  await waitFor(
    () => output.includes(`Wiki: http://0.0.0.0:${port}`),
    "server did not start",
  );
  const blocked = call(["maintenance", "--root", root, "--", "/usr/bin/true"]);
  assert.equal(blocked.status, 3);
  assert.equal(JSON.parse(blocked.stderr).code, "LIFECYCLE_BUSY");
  const response = await new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/healthz",
        headers: { Host: "wiki.example.test" },
      },
      resolve,
    );
    request.on("error", reject);
  });
  response.resume();
  assert.equal(response.statusCode, 200);
  const closed = once(child, "close");
  child.kill("SIGTERM");
  await closed;
  const available = call([
    "maintenance",
    "--root",
    root,
    "--",
    "/usr/bin/true",
  ]);
  assert.equal(available.status, 0, available.stderr);
});

test("a writable Git descendant retains ownership after its parent is killed", async (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  const shim = path.join(directory, "shim");
  const signal = path.join(directory, "commit-tree.waiting");
  const gate = path.join(directory, "continue");
  fs.mkdirSync(shim);
  const gitShim = path.join(shim, "git");
  fs.writeFileSync(
    gitShim,
    `#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.includes("commit-tree")) {
  fs.writeFileSync(process.env.GIT_GATE_SIGNAL, "waiting");
  while (!fs.existsSync(process.env.GIT_GATE_OPEN)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
}
const result = spawnSync(process.env.REAL_GIT, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const child = spawn(
    python,
    [lifecycle, "maintenance", "--root", root, "--", process.execPath, editor],
    {
      cwd: source,
      env: {
        ...process.env,
        PATH: shim + path.delimiter + process.env.PATH,
        REAL_GIT: realGit,
        GIT_GATE_SIGNAL: signal,
        GIT_GATE_OPEN: gate,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.end(savedDraft("interrupted-write", "interrupted"));
  await waitFor(
    () => fs.existsSync(signal),
    "Git child never reached commit-tree",
  );
  const closed = once(child, "close");
  child.kill("SIGKILL");
  await closed;
  const active = JSON.parse(call(["status", "--root", root]).stdout);
  assert.equal(
    active.active_owner,
    true,
    "orphaned Git child must retain the kernel fence",
  );
  const blocked = call(["maintenance", "--root", root, "--", "/usr/bin/true"]);
  assert.equal(blocked.status, 3);
  fs.writeFileSync(gate, "continue");
  await waitFor(
    () =>
      JSON.parse(call(["status", "--root", root]).stdout).active_owner ===
      false,
    "orphaned Git child did not release the fence",
  );

  const retained = path.join(root, "content/.git/wiki-write.lock.d");
  assert.equal(fs.existsSync(retained), true);
  fs.writeFileSync(path.join(retained, "owner.json"), "unknown owner\n");
  const refused = call(["serve", "--root", root]);
  assert.equal(refused.status, 3);
  assert.equal(JSON.parse(refused.stderr).code, "INTERRUPTED_WRITE");
  const inspection = path.join(directory, "recovery.json");
  const inspected = call([
    "inspect-recovery",
    "--root",
    root,
    "--output",
    inspection,
  ]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).owner_valid, false);

  execFileSync("git", [
    "-C",
    path.join(root, "content"),
    "commit",
    "--allow-empty",
    "-m",
    "Synthetic drift",
  ]);
  const drifted = call(["recover", "--root", root, "--manifest", inspection]);
  assert.equal(drifted.status, 3);
  assert.equal(JSON.parse(drifted.stderr).code, "RECOVERY_DRIFT");
  const currentInspection = path.join(directory, "recovery-current.json");
  assert.equal(
    call(["inspect-recovery", "--root", root, "--output", currentInspection])
      .status,
    0,
  );
  const recovered = call([
    "recover",
    "--root",
    root,
    "--manifest",
    currentInspection,
  ]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(fs.existsSync(retained), false);
  const write = call(
    ["maintenance", "--root", root, "--", process.execPath, editor],
    { input: savedDraft("after-recovery", "recovered") },
  );
  assert.equal(write.status, 0, write.stderr);
  assert.equal(JSON.parse(write.stdout).state, "saved");
});

test("backup and fresh-root restore preserve authoritative state and remain writable", (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  const write = call(
    ["maintenance", "--root", root, "--", process.execPath, editor],
    { input: savedDraft("before-backup", "preserved") },
  );
  assert.equal(write.status, 0, write.stderr);
  const imported = call([
    "maintenance",
    "--root",
    root,
    "--",
    process.execPath,
    path.join(source, "scripts/import-trace.mjs"),
    path.join(root, "traces"),
    path.join(source, "examples/traces/codex.jsonl"),
    "Synthetic lifecycle evidence",
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  const published = call([
    "maintenance",
    "--root",
    root,
    "--",
    process.execPath,
    path.join(source, "scripts/publish-article-media.mjs"),
    path.join(source, "docs/assets/atlas-labs-desktop.png"),
    "--source",
    "synthetic-lifecycle-test",
  ]);
  assert.equal(published.status, 0, published.stderr);
  const originalHead = execFileSync(
    "git",
    ["-C", path.join(root, "content"), "rev-parse", "HEAD"],
    {
      encoding: "utf8",
    },
  ).trim();
  const originalControl = new DatabaseSync(
    path.join(root, "control/control.sqlite3"),
    { readOnly: true },
  );
  const identityCount = originalControl
    .prepare("SELECT COUNT(*) AS count FROM identities")
    .get().count;
  const grantCount = originalControl
    .prepare("SELECT COUNT(*) AS count FROM grants")
    .get().count;
  originalControl.close();
  const archive = path.join(directory, "independent", "wiki-backup.tar.gz");
  const backedUp = call(["backup", "--root", root, "--destination", archive]);
  assert.equal(backedUp.status, 0, backedUp.stderr);
  const backupReceipt = JSON.parse(backedUp.stdout);
  assert.match(backupReceipt.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
  const refusedReplacement = call([
    "backup",
    "--root",
    root,
    "--destination",
    archive,
  ]);
  assert.equal(refusedReplacement.status, 3);
  assert.equal(
    JSON.parse(refusedReplacement.stderr).code,
    "DESTINATION_EXISTS",
  );
  assert.equal(sha256(archive), backupReceipt.sha256);
  const restored = path.join(directory, "fresh-root");
  const restore = call(["restore", "--root", restored, "--archive", archive]);
  assert.equal(restore.status, 0, restore.stderr);
  assert.equal(JSON.parse(restore.stdout).content_head, originalHead);
  assert.equal(
    execFileSync(
      "git",
      ["-C", path.join(restored, "content"), "rev-parse", "HEAD"],
      {
        encoding: "utf8",
      },
    ).trim(),
    originalHead,
  );
  assert.match(
    execFileSync(
      "git",
      [
        "-C",
        path.join(restored, "content"),
        "show",
        "HEAD:.wiki/operations/before-backup.json",
      ],
      {
        encoding: "utf8",
      },
    ),
    /before-backup/,
  );
  const restoredControl = new DatabaseSync(
    path.join(restored, "control/control.sqlite3"),
    { readOnly: true },
  );
  assert.equal(
    restoredControl.prepare("SELECT COUNT(*) AS count FROM identities").get()
      .count,
    identityCount,
  );
  assert.equal(
    restoredControl.prepare("SELECT COUNT(*) AS count FROM grants").get().count,
    grantCount,
  );
  restoredControl.close();
  assert.ok(
    fs
      .readdirSync(path.join(restored, "traces"))
      .some((name) => /^[a-f0-9]{64}$/.test(name)),
  );
  assert.ok(
    fs.readdirSync(path.join(restored, "article-media/publications")).length >
      0,
  );
  const after = call(
    ["maintenance", "--root", restored, "--", process.execPath, editor],
    { input: savedDraft("after-restore", "restored-write") },
  );
  assert.equal(after.status, 0, after.stderr);
  assert.equal(JSON.parse(after.stdout).state, "saved");
});

test("restore stages inside a writable managed root when its parent is read-only", (t) => {
  if (process.getuid?.() === 0)
    t.skip("root can bypass the parent permission boundary");
  const directory = temporary(t);
  const sourceRoot = path.join(directory, "source-root");
  assert.equal(bootstrap(sourceRoot).status, 0);
  const archive = path.join(directory, "wiki-backup.tar.gz");
  assert.equal(
    call(["backup", "--root", sourceRoot, "--destination", archive]).status,
    0,
  );
  const restored = path.join(directory, "fresh-root");
  fs.mkdirSync(restored, { mode: 0o700 });
  fs.chmodSync(directory, 0o555);
  let result;
  try {
    assert.throws(
      () =>
        fs.writeFileSync(path.join(directory, "parent-write-must-fail"), "x"),
      /EACCES|EPERM/,
    );
    result = call(["restore", "--root", restored, "--archive", archive]);
  } finally {
    fs.chmodSync(directory, 0o700);
  }
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, "restored");
  assert.equal(
    fs
      .readdirSync(path.join(restored, ".lifecycle"))
      .some((name) => name.startsWith(".restore-staging-")),
    false,
  );
  assert.equal(fs.existsSync(path.join(restored, "content/.git")), true);
});

test("restore rejects traversal and hard-link archives before writing state", (t) => {
  const directory = temporary(t);
  for (const kind of ["traversal", "hardlink"]) {
    const archive = path.join(directory, `${kind}.tar`);
    const program = `
import io, tarfile, sys
with tarfile.open(sys.argv[1], "w") as archive:
    item = tarfile.TarInfo("../escape" if sys.argv[2] == "traversal" else "content/linked")
    if sys.argv[2] == "hardlink":
        item.type = tarfile.LNKTYPE
        item.linkname = "content/target"
        archive.addfile(item)
    else:
        data = b"escape"
        item.size = len(data)
        archive.addfile(item, io.BytesIO(data))
`;
    assert.equal(spawnSync(python, ["-c", program, archive, kind]).status, 0);
    const root = path.join(directory, `${kind}-root`);
    const result = call(["restore", "--root", root, "--archive", archive]);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).code, "UNSAFE_ARCHIVE");
    assert.equal(fs.existsSync(path.join(directory, "escape")), false);
    assert.deepEqual(
      fs.readdirSync(root).filter((name) => name !== ".lifecycle"),
      [],
    );
  }
});

test("restore rejects executable Git configuration before invoking the restored repository", (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  const trusted = path.join(directory, "trusted.tar.gz");
  assert.equal(
    call(["backup", "--root", root, "--destination", trusted]).status,
    0,
  );
  const hostile = path.join(directory, "hostile.tar.gz");
  const marker = path.join(directory, "fsmonitor-executed");
  const hook = path.join(directory, "fsmonitor-hook");
  fs.writeFileSync(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, {
    mode: 0o755,
  });
  const rewrite = `
import hashlib, json, os, pathlib, stat, tarfile, tempfile, sys
source, target, hook = sys.argv[1:]
with tempfile.TemporaryDirectory() as temporary:
    with tarfile.open(source, "r:gz") as archive:
        archive.extractall(temporary)
    config = pathlib.Path(temporary) / "content" / ".git" / "config"
    with config.open("a") as stream:
        stream.write("\\n[core]\\n\\tfsmonitor = " + hook + "\\n")
    manifest_file = pathlib.Path(temporary) / "backup-manifest.json"
    manifest = json.loads(manifest_file.read_text())
    for name in manifest["files"]:
        filename = pathlib.Path(temporary) / name
        data = filename.read_bytes()
        manifest["files"][name] = {
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "mode": stat.S_IMODE(filename.stat().st_mode),
        }
    manifest_file.write_text(json.dumps(manifest))
    with tarfile.open(target, "w:gz") as archive:
        for name in sorted(os.listdir(temporary)):
            archive.add(pathlib.Path(temporary) / name, arcname=name)
`;
  assert.equal(
    spawnSync(python, ["-c", rewrite, trusted, hostile, hook]).status,
    0,
  );
  const restored = path.join(directory, "restored");
  const result = call(["restore", "--root", restored, "--archive", hostile]);
  assert.notEqual(result.status, 0);
  assert.equal(
    JSON.parse(result.stderr).code,
    "UNSAFE_GIT_CONFIG",
    result.stderr,
  );
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(
    fs.readdirSync(restored).filter((name) => name !== ".lifecycle"),
    [],
  );
  assert.equal(
    fs
      .readdirSync(path.join(restored, ".lifecycle"))
      .some((name) => name.startsWith(".restore-staging-")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(restored, ".lifecycle/initialized.json")),
    false,
  );
});

test("restore rejects Git object redirects before invoking the restored repository", (t) => {
  const directory = temporary(t);
  const root = path.join(directory, "root");
  assert.equal(bootstrap(root).status, 0);
  const trusted = path.join(directory, "trusted.tar.gz");
  assert.equal(
    call(["backup", "--root", root, "--destination", trusted]).status,
    0,
  );
  const hostile = path.join(directory, "redirect.tar.gz");
  const rewrite = `
import hashlib, json, os, pathlib, stat, tarfile, tempfile, sys
source, target = sys.argv[1:]
with tempfile.TemporaryDirectory() as temporary:
    with tarfile.open(source, "r:gz") as archive:
        archive.extractall(temporary)
    redirect = pathlib.Path(temporary) / "content" / ".git" / "objects" / "info" / "alternates"
    redirect.parent.mkdir(parents=True, exist_ok=True)
    redirect.write_text("/tmp/unvalidated-object-store\\n")
    manifest_file = pathlib.Path(temporary) / "backup-manifest.json"
    manifest = json.loads(manifest_file.read_text())
    manifest["files"]["content/.git/objects/info/alternates"] = {}
    for name in manifest["files"]:
        filename = pathlib.Path(temporary) / name
        data = filename.read_bytes()
        manifest["files"][name] = {
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "mode": stat.S_IMODE(filename.stat().st_mode),
        }
    manifest_file.write_text(json.dumps(manifest))
    with tarfile.open(target, "w:gz") as archive:
        for name in sorted(os.listdir(temporary)):
            archive.add(pathlib.Path(temporary) / name, arcname=name)
`;
  assert.equal(spawnSync(python, ["-c", rewrite, trusted, hostile]).status, 0);
  const restored = path.join(directory, "restored");
  const result = call(["restore", "--root", restored, "--archive", hostile]);
  assert.notEqual(result.status, 0);
  assert.equal(
    JSON.parse(result.stderr).code,
    "UNSAFE_GIT_STRUCTURE",
    result.stderr,
  );
  assert.deepEqual(
    fs.readdirSync(restored).filter((name) => name !== ".lifecycle"),
    [],
  );
  assert.equal(
    fs
      .readdirSync(path.join(restored, ".lifecycle"))
      .some((name) => name.startsWith(".restore-staging-")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(restored, ".lifecycle/initialized.json")),
    false,
  );
});

test("a lifecycle environment string without the expected inherited fd is rejected", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { lifecycleLockFd } from ${JSON.stringify(new URL("../src/lifecycle-lock.mjs", import.meta.url).href)}; lifecycleLockFd();`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        WIKI_LIFECYCLE_ROOT: "/tmp/not-a-managed-root",
        WIKI_LIFECYCLE_LOCK: "/tmp/not-a-managed-root/.lifecycle/owner.lock",
        WIKI_LIFECYCLE_LOCK_FD: "3",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lifecycle lock|fstat|EBADF/i);
});
