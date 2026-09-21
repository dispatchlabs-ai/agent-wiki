#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const qualifierRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(qualifierRoot, "qualify-package-fixtures");
const startedAt = new Date();
const { values } = parseArgs({
  options: {
    "package-root": { type: "string" },
    receipt: { type: "string" },
    "keep-evidence": { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
  },
});

if (!values["package-root"] || !values.receipt) {
  console.error(
    "Usage: node scripts/qualify-package.mjs --package-root /immutable/package --receipt /private/receipt.json [--keep-evidence] [--headed]",
  );
  process.exit(2);
}

const packageRoot = fs.realpathSync(path.resolve(values["package-root"]));
const receiptPath = path.resolve(values.receipt);
const evidenceRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "agent-wiki-package-qualification-"),
);
fs.chmodSync(evidenceRoot, 0o700);
if (fs.existsSync(receiptPath)) throw Error("Receipt path already exists");
fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (filename) => sha256(fs.readFileSync(filename));
const executable = (name) => path.join(packageRoot, "bin", name);
const lifecycle = executable("agent-wiki");
const lifecycleAlias = executable("agent-wiki-lifecycle");
const timings = {};
const checks = {};
const secrets = new Set();
let commandSequence = 0;
let activeServer;
let proxy;
let browser;
let context;
let page;

function assert(condition, message) {
  if (!condition) throw Error(message);
}

function privateWrite(filename, value) {
  fs.writeFileSync(path.join(evidenceRoot, filename), value, {
    mode: 0o600,
  });
}

function sanitize(value) {
  let text = String(value || "qualification failed").replace(
    // Browser call logs can contain terminal styling escapes.
    /\u001b\[[0-9;]*m/g,
    "",
  );
  for (const secret of secrets)
    if (secret) text = text.split(secret).join("[REDACTED]");
  return text.split(evidenceRoot).join("[PRIVATE_EVIDENCE]");
}

async function step(name, action) {
  const start = performance.now();
  try {
    return await action();
  } finally {
    timings[name] = Math.round(performance.now() - start);
  }
}

async function command(name, program, args, options = {}) {
  const sequence = String(++commandSequence).padStart(2, "0");
  const child = spawn(program, args, {
    cwd: options.cwd || evidenceRoot,
    env: options.env || process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  if (options.input !== undefined) child.stdin.end(options.input);
  else child.stdin.end();
  let timer;
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({ status: code, signal, stdout, stderr }),
    );
    if (options.timeout)
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error(`${name} timed out`));
      }, options.timeout);
  }).finally(() => clearTimeout(timer));
  privateWrite(`${sequence}-${name}.stdout`, stdout);
  privateWrite(`${sequence}-${name}.stderr`, stderr);
  return result;
}

function accepted(result, name) {
  assert(result.status === 0, `${name} failed; inspect private evidence`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw Error(`${name} returned invalid JSON; inspect private evidence`);
  }
}

function rejected(result, code, name) {
  assert(result.status !== 0, `${name} unexpectedly succeeded`);
  let failure;
  try {
    failure = JSON.parse(result.stderr.trim().split("\n").at(-1));
  } catch {
    throw Error(`${name} returned an unstructured failure`);
  }
  assert(
    failure.code === code,
    `${name} returned ${failure.code}, expected ${code}`,
  );
  return failure;
}

const managed = (name, args, options) =>
  command(name, lifecycle, args, options);

async function reservePort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error(`${message}${last ? `: ${last.message}` : ""}`);
}

async function startProxy(backendPort) {
  const key = path.join(evidenceRoot, "localhost.key.pem");
  const cert = path.join(evidenceRoot, "localhost.cert.pem");
  const generated = await command("self-signed-certificate", "openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  assert(
    generated.status === 0,
    "Unable to generate the temporary TLS certificate",
  );
  fs.chmodSync(key, 0o600);
  const server = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    (request, response) => {
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: backendPort,
          method: request.method,
          path: request.url,
          headers: request.headers,
        },
        (incoming) => {
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.once("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end("Temporary proxy upstream unavailable");
      });
      request.pipe(upstream);
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, origin: `https://127.0.0.1:${server.address().port}` };
}

async function startWiki(root, origin, backendPort, label) {
  assert(!activeServer, "A managed server is already active");
  const stdoutFile = path.join(evidenceRoot, `${label}.stdout`);
  const stderrFile = path.join(evidenceRoot, `${label}.stderr`);
  const stdout = fs.openSync(stdoutFile, "w", 0o600);
  const stderr = fs.openSync(stderrFile, "w", 0o600);
  const child = spawn(
    lifecycle,
    [
      "serve",
      "--root",
      root,
      "--origin",
      origin,
      "--bind",
      "127.0.0.1",
      "--port",
      String(backendPort),
    ],
    {
      cwd: evidenceRoot,
      env: {
        ...process.env,
        WIKI_LOCAL_LOGIN: "1",
        WIKI_WRITE: "1",
        WIKI_PUSH: "0",
        WIKI_DATABASE: ":memory:",
      },
      stdio: ["ignore", stdout, stderr],
    },
  );
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  activeServer = child;
  await waitFor(
    () =>
      new Promise((resolve) => {
        const request = http.get(
          {
            hostname: "127.0.0.1",
            port: backendPort,
            path: "/healthz",
            headers: { Host: new URL(origin).host },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode === 200);
          },
        );
        request.once("error", () => resolve(false));
      }),
    `${label} did not become healthy`,
  );
  assert(child.exitCode === null, `${label} exited during startup`);
  return child;
}

async function stopWiki() {
  if (!activeServer) return;
  const child = activeServer;
  activeServer = undefined;
  const closed = once(child, "close");
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Managed server did not stop")), 10_000),
    ),
  ]).catch((error) => {
    child.kill("SIGKILL");
    throw error;
  });
}

function mcpEnvelope(text) {
  const data = text.startsWith("event:")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  assert(data, "MCP response omitted its JSON envelope");
  return JSON.parse(data);
}

let mcpId = 0;
async function mcpCall(origin, csrf, name, args) {
  const response = await context.request.post(origin + "/mcp", {
    headers: {
      Origin: origin,
      "X-Wiki-CSRF": csrf,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-03-26",
    },
    data: {
      jsonrpc: "2.0",
      id: ++mcpId,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  const envelope = mcpEnvelope(await response.text());
  assert(
    response.status() === 200,
    `MCP ${name} returned HTTP ${response.status()}`,
  );
  assert(
    !envelope.error && !envelope.result?.isError,
    `MCP ${name} was rejected`,
  );
  const text = envelope.result?.content?.find(
    (item) => item.type === "text",
  )?.text;
  assert(text, `MCP ${name} returned no text result`);
  return JSON.parse(text);
}

async function profile(origin) {
  const response = await context.request.get(origin + "/api/me");
  assert(
    response.status() === 200,
    "Authenticated browser session was not accepted",
  );
  return response.json();
}

function draft(operation, id, body, expected = null) {
  return {
    operation_id: operation,
    updates: [
      {
        id,
        expected_revision_id: expected,
        title: id === "guide" ? "Portable package guide" : "Recovery proof",
        description: "Synthetic immutable-package qualification content",
        topic: "Qualification",
        body,
        summary: `Synthetic qualification operation ${operation}`,
      },
    ],
  };
}

function writeReceipt(value) {
  fs.writeFileSync(receiptPath, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

async function closeRuntime() {
  await stopWiki().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (proxy)
    await new Promise((resolve) => proxy.server.close(() => resolve()));
}

let packageEvidence;
let resultEvidence = {};
try {
  packageEvidence = await step("package_identity", async () => {
    const rootStat = fs.statSync(packageRoot);
    assert(rootStat.isDirectory(), "Package root must be a directory");
    assert(
      (rootStat.mode & 0o222) === 0,
      "Package root is writable; supply an existing immutable package output",
    );
    const identityFile = path.join(
      packageRoot,
      "share",
      "agent-wiki",
      "package-identity.json",
    );
    const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"));
    const fromEntrypoint = accepted(
      await command("package-info", executable("agent-wiki-package-info"), []),
      "package identity entrypoint",
    );
    assert(
      JSON.stringify(identity) === JSON.stringify(fromEntrypoint),
      "Package identity file and entrypoint disagree",
    );
    for (const name of [
      ...identity.executableEntrypoints,
      "agent-wiki-package-info",
    ])
      assert(
        fs.statSync(executable(name)).isFile(),
        `Missing packaged entrypoint ${name}`,
      );
    return {
      root: packageRoot,
      identity,
      identity_sha256: fileSha256(identityFile),
      entrypoints: Object.fromEntries(
        [...identity.executableEntrypoints, "agent-wiki-package-info"]
          .sort()
          .map((name) => [name, fileSha256(executable(name))]),
      ),
    };
  });

  const managedRoot = path.join(evidenceRoot, "managed-root");
  const restoredRoot = path.join(evidenceRoot, "restored-root");
  const independent = path.join(evidenceRoot, "independent-backup");
  fs.mkdirSync(independent, { mode: 0o700 });
  const backendPort = await reservePort();
  proxy = await step("temporary_https_proxy", () => startProxy(backendPort));
  const origin = proxy.origin;
  const password = `synthetic-${randomBytes(24).toString("base64url")}`;
  secrets.add(password);

  const bootstrap = await step("empty_bootstrap", async () => {
    const created = accepted(
      await managed("bootstrap", [
        "bootstrap",
        "--root",
        managedRoot,
        "--origin",
        origin,
        "--manager-email",
        "manager@example.invalid",
        "--manager-name",
        "Synthetic package manager",
      ]),
      "managed bootstrap",
    );
    const token = new URL(created.setup_url).hash.slice(1);
    secrets.add(token);
    assert(
      fs.existsSync(path.join(managedRoot, ".lifecycle", "initialized.json")),
      "Bootstrap marker is missing",
    );
    const repeat = await managed("rebootstrap-refusal", [
      "bootstrap",
      "--root",
      managedRoot,
      "--origin",
      origin,
      "--manager-email",
      "other@example.invalid",
      "--manager-name",
      "Other manager",
    ]);
    rejected(repeat, "ALREADY_INITIALIZED", "rebootstrap");
    const aliasStatus = accepted(
      await command("lifecycle-alias-status", lifecycleAlias, [
        "status",
        "--root",
        managedRoot,
      ]),
      "managed lifecycle alias",
    );
    assert(
      aliasStatus.state === "ready",
      "Lifecycle alias did not inspect the managed root",
    );
    checks.empty_bootstrap = true;
    checks.rebootstrap_refused = true;
    checks.managed_entrypoint_alias = true;
    return { setup_url: created.setup_url, initial_head: created.content_head };
  });

  const traceFile = path.join(fixtures, "synthetic-codex.jsonl");
  const mediaFile = path.join(evidenceRoot, "synthetic-pixel.png");
  const mediaBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(mediaFile, mediaBytes, { mode: 0o600 });
  const offline = await step("offline_evidence_import", async () => {
    const trace = accepted(
      await managed("trace-import", [
        "maintenance",
        "--root",
        managedRoot,
        "--",
        executable("agent-wiki-import-trace-direct"),
        path.join(managedRoot, "traces"),
        traceFile,
        "Synthetic package qualification evidence",
      ]),
      "trace import",
    );
    const media = accepted(
      await managed("media-publication", [
        "maintenance",
        "--root",
        managedRoot,
        "--",
        executable("agent-wiki-publish-media-direct"),
        mediaFile,
        "--source",
        "synthetic-package-qualification",
        "--name",
        "Synthetic qualification pixel",
      ]),
      "media publication",
    );
    checks.offline_maintenance = true;
    return { trace, media };
  });

  await step("initial_server_start", () =>
    startWiki(managedRoot, origin, backendPort, "server-initial"),
  );
  const active = accepted(
    await managed("active-status", ["status", "--root", managedRoot]),
    "active lifecycle status",
  );
  assert(
    active.active_owner === true,
    "Managed server did not retain lifecycle ownership",
  );
  const blocked = await managed("serve-maintenance-exclusion", [
    "maintenance",
    "--root",
    managedRoot,
    "--",
    "/usr/bin/true",
  ]);
  rejected(blocked, "LIFECYCLE_BUSY", "concurrent maintenance");
  checks.serve_maintenance_exclusion = true;

  const { chromium } = await import("playwright");
  browser = await step("chromium_launch", () =>
    chromium.launch({ headless: !values.headed }),
  );
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const browserEvidence = await step("browser_setup_and_edit", async () => {
    await page.goto(bootstrap.setup_url, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Set password and sign in" })
      .click();
    await page.waitForURL(origin + "/", { timeout: 10_000 });
    const human = await profile(origin);
    assert(
      human.role === "manager" && human.localAccount,
      "Bootstrap identity is not the local manager",
    );
    const created = await mcpCall(
      origin,
      human.csrf,
      "wiki.save",
      draft(
        "package-mcp-create",
        "guide",
        `Initial MCP content.\n\n[Published media](${offline.media.url})\n`,
      ),
    );
    assert(
      created.actor === human.id,
      "MCP write actor differs from browser identity",
    );
    const mcpRead = await mcpCall(origin, human.csrf, "wiki.read", {
      id: "guide",
    });
    assert(
      mcpRead.body.includes("Initial MCP content"),
      "MCP read did not return its write",
    );
    await page.goto(origin + "/wiki/guide/edit/", {
      waitUntil: "domcontentloaded",
    });
    const save = page.getByRole("button", { name: "Save revision" });
    await waitFor(
      () => save.isEnabled(),
      "Browser editor did not become writable",
    );
    await page
      .getByLabel("Markdown", { exact: true })
      .fill(
        `Browser edit survived the packaged writer.\n\n[Published media](${offline.media.url})\n`,
      );
    await page
      .getByLabel("Change summary")
      .fill("Verify browser write through managed package");
    await save.click();
    await waitFor(
      async () =>
        (await page.getByRole("status").textContent())?.includes(
          "Saved in Git",
        ),
      "Browser edit did not report a Git save",
    );
    await page.goto(origin + "/wiki/guide/", { waitUntil: "domcontentloaded" });
    assert(
      (await page.locator("article").textContent()).includes(
        "Browser edit survived",
      ),
      "Browser read did not return the browser edit",
    );
    const readAfterBrowser = await mcpCall(origin, human.csrf, "wiki.read", {
      id: "guide",
    });
    assert(
      readAfterBrowser.body.includes("Browser edit survived"),
      "MCP did not observe browser edit",
    );
    const trace = await mcpCall(origin, human.csrf, "wiki.trace", {
      id: offline.trace.id,
    });
    assert(
      JSON.stringify(trace).includes("portable package"),
      "Imported trace was not readable",
    );
    const mediaResponse = await context.request.get(origin + offline.media.url);
    assert(mediaResponse.status() === 200, "Published media was not readable");
    assert(
      sha256(await mediaResponse.body()) === sha256(mediaBytes),
      "Published media bytes changed",
    );
    assert(pageErrors.length === 0, "Browser reported a page error");
    checks.browser_setup = true;
    checks.browser_read_write = true;
    checks.mcp_read_write = true;
    checks.trace_readback = true;
    checks.media_readback = true;
    return {
      principal: human.id,
      role: human.role,
      guide_revision: readAfterBrowser.revision_id,
    };
  });

  await step("process_restart_stop", () => stopWiki());
  await step("process_restart_start", () =>
    startWiki(managedRoot, origin, backendPort, "server-restarted"),
  );
  const restarted = await profile(origin);
  assert(
    restarted.id === browserEvidence.principal &&
      restarted.role === browserEvidence.role,
    "Process restart changed the authenticated identity or grant",
  );
  const persisted = await mcpCall(origin, restarted.csrf, "wiki.read", {
    id: "guide",
  });
  assert(
    persisted.revision_id === browserEvidence.guide_revision,
    "Process restart changed content revision",
  );
  checks.process_restart_persistence = true;
  await stopWiki();

  const beforeBackup = accepted(
    await managed("pre-backup-status", ["status", "--root", managedRoot]),
    "pre-backup status",
  );
  const archive = path.join(independent, "agent-wiki-backup.tar.gz");
  const backup = await step("offline_backup", async () =>
    accepted(
      await managed("backup", [
        "backup",
        "--root",
        managedRoot,
        "--destination",
        archive,
      ]),
      "managed backup",
    ),
  );
  assert(
    (fs.statSync(archive).mode & 0o777) === 0o600,
    "Backup is not mode 0600",
  );
  assert(
    fileSha256(archive) === backup.sha256,
    "Backup digest does not match its receipt",
  );
  const restore = await step("fresh_root_restore", async () =>
    accepted(
      await managed("restore", [
        "restore",
        "--root",
        restoredRoot,
        "--archive",
        archive,
      ]),
      "managed restore",
    ),
  );
  assert(
    restore.content_head === beforeBackup.content_head,
    "Restore changed the content HEAD",
  );
  checks.independent_backup_restore = true;

  await step("restored_server_start", () =>
    startWiki(restoredRoot, origin, backendPort, "server-restored"),
  );
  const restoredIdentity = await profile(origin);
  assert(
    restoredIdentity.id === browserEvidence.principal &&
      restoredIdentity.role === browserEvidence.role,
    "Restore changed the principal or manager grant",
  );
  const restoredGuide = await mcpCall(
    origin,
    restoredIdentity.csrf,
    "wiki.read",
    { id: "guide" },
  );
  assert(
    restoredGuide.revision_id === browserEvidence.guide_revision,
    "Restore changed article content",
  );
  await page.goto(origin + "/wiki/guide/", { waitUntil: "domcontentloaded" });
  assert(
    (await page.locator("article").textContent()).includes(
      "Browser edit survived",
    ),
    "Restored browser session could not read preserved content",
  );
  const restoredTrace = await mcpCall(
    origin,
    restoredIdentity.csrf,
    "wiki.trace",
    { id: offline.trace.id },
  );
  assert(
    JSON.stringify(restoredTrace).includes("portable package"),
    "Restore lost trace evidence",
  );
  const restoredMedia = await context.request.get(origin + offline.media.url);
  assert(
    restoredMedia.status() === 200 &&
      sha256(await restoredMedia.body()) === sha256(mediaBytes),
    "Restore lost published media",
  );
  const restoredWrite = await mcpCall(
    origin,
    restoredIdentity.csrf,
    "wiki.save",
    draft(
      "package-write-after-restore",
      "restored-write",
      "The fresh restored root accepted an authenticated write.\n",
    ),
  );
  assert(
    restoredWrite.actor === browserEvidence.principal,
    "Fresh-root restore write used a different principal",
  );
  const restoredWriteRead = await mcpCall(
    origin,
    restoredIdentity.csrf,
    "wiki.read",
    { id: "restored-write" },
  );
  assert(
    restoredWriteRead.body.includes("accepted an authenticated write"),
    "Fresh-root restore write was not readable",
  );
  checks.principal_grant_continuity = true;
  checks.restored_evidence_readback = true;
  checks.write_after_restore = true;
  await stopWiki();

  const retained = accepted(
    await managed("retain-writer-evidence", [
      "maintenance",
      "--root",
      restoredRoot,
      "--",
      "node",
      path.join(fixtures, "retain-writer-evidence.mjs"),
    ]),
    "interrupted writer fixture",
  );
  assert(
    retained.retained,
    "Interrupted writer fixture did not retain evidence",
  );
  const refusedServe = await managed(
    "interrupted-serve-refusal",
    ["serve", "--root", restoredRoot, "--port", String(backendPort)],
    { timeout: 5_000 },
  );
  rejected(
    refusedServe,
    "INTERRUPTED_WRITE",
    "serve with retained writer evidence",
  );
  const recoveryManifest = path.join(independent, "recovery-manifest.json");
  const inspection = accepted(
    await managed("inspect-recovery", [
      "inspect-recovery",
      "--root",
      restoredRoot,
      "--output",
      recoveryManifest,
    ]),
    "recovery inspection",
  );
  assert(
    inspection.owner_valid === false,
    "Synthetic interrupted owner unexpectedly validated",
  );
  const recovery = accepted(
    await managed("recover", [
      "recover",
      "--root",
      restoredRoot,
      "--manifest",
      recoveryManifest,
    ]),
    "managed recovery",
  );
  assert(
    recovery.manifest_sha256 === inspection.manifest_sha256,
    "Recovery did not consume the inspected manifest",
  );
  checks.interrupted_write_recovery = true;

  await step("post_recovery_server_start", () =>
    startWiki(restoredRoot, origin, backendPort, "server-post-recovery"),
  );
  const afterRecoveryIdentity = await profile(origin);
  const recoveryWrite = await mcpCall(
    origin,
    afterRecoveryIdentity.csrf,
    "wiki.save",
    draft(
      "package-write-after-recovery",
      "recovery-proof",
      "The fresh restore remained writable after explicit recovery.\n",
    ),
  );
  assert(
    recoveryWrite.actor === browserEvidence.principal,
    "Post-recovery writer identity changed",
  );
  const recoveryRead = await mcpCall(
    origin,
    afterRecoveryIdentity.csrf,
    "wiki.read",
    { id: "recovery-proof" },
  );
  assert(
    recoveryRead.body.includes("remained writable"),
    "Post-recovery write was not readable",
  );
  checks.write_after_recovery = true;
  await stopWiki();

  await closeRuntime();
  const finishedAt = new Date();
  resultEvidence = {
    schema_version: 1,
    result: "passed",
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt - startedAt,
    package: packageEvidence,
    qualifier: {
      script_sha256: fileSha256(fileURLToPath(import.meta.url)),
      trace_fixture_sha256: fileSha256(traceFile),
      recovery_fixture_sha256: fileSha256(
        path.join(fixtures, "retain-writer-evidence.mjs"),
      ),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      chromium: "external Playwright installation",
    },
    timings_ms: timings,
    checks,
    continuity: {
      principal: browserEvidence.principal,
      role: browserEvidence.role,
      content_head: beforeBackup.content_head,
      trace_id: offline.trace.id,
      media_sha256: offline.media.sha256,
      backup_sha256: backup.sha256,
      recovery_manifest_sha256: recovery.manifest_sha256,
    },
    claims: {
      process_restart: { tested: true, result: "passed" },
      service_manager_restart: { tested: false },
      wsl: { tested: false },
      host_reboot: { tested: false },
    },
    private_evidence_retained: Boolean(values["keep-evidence"]),
  };
  if (!values["keep-evidence"])
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  else resultEvidence.private_evidence_directory = evidenceRoot;
  writeReceipt(resultEvidence);
  console.log(
    JSON.stringify({
      result: "passed",
      receipt: receiptPath,
      package: packageEvidence.identity,
      duration_ms: resultEvidence.duration_ms,
    }),
  );
} catch (error) {
  try {
    if (page)
      await page.screenshot({
        path: path.join(evidenceRoot, "failure.png"),
        fullPage: true,
      });
  } catch {}
  await closeRuntime();
  const failure = {
    schema_version: 1,
    result: "failed",
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    package: packageEvidence,
    timings_ms: timings,
    checks,
    error: sanitize(error?.message),
    private_evidence_directory: evidenceRoot,
  };
  try {
    writeReceipt(failure);
  } catch {}
  console.error(
    JSON.stringify({
      result: "failed",
      receipt: receiptPath,
      private_evidence_directory: evidenceRoot,
      error: failure.error,
    }),
  );
  process.exitCode = 1;
}
