#!/usr/bin/env node
// Explicit, optional model-driven acceptance against disposable synthetic content.
import assert from "node:assert/strict";
import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { fixture } from "../tests/helpers.mjs";
import { ControlStore } from "../src/control-store.mjs";
import { AgentStore } from "../src/agent-store.mjs";
import { createWiki } from "../src/server.mjs";
import { importTrace } from "../src/traces.mjs";
import { indexTraces } from "../src/trace-search.mjs";

if (process.argv[2] !== "--run") {
  console.log(
    "Usage: node scripts/verify-pi.mjs --run\nRequires an authenticated Pi Code CLI. Uses its configured model/account and consumes model usage. Creates only temporary synthetic wiki content; never connects to your real wiki.",
  );
  process.exit(0);
}
const engine = fileURLToPath(new URL("..", import.meta.url));
const cleanup = [];
const repo = fixture({ after: (f) => cleanup.push(f) });
let app, control, child, timer;
try {
  const reserve = http.createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  const owner = control.bootstrap({
    issuer: "https://example.invalid",
    subject: "synthetic",
    name: "Synthetic owner",
  });
  const config = path.join(repo, ".git/probe.json");
  const generated = spawnSync(
    process.execPath,
    [
      path.join(engine, "scripts/agent-keygen.mjs"),
      config,
      "--origin",
      origin,
      "--name",
      "Synthetic Pi",
      "--role",
      "editor",
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, "Synthetic credential generation failed");
  const spec = JSON.parse(
    fs.readFileSync(JSON.parse(generated.stdout).publicRegistration, "utf8"),
  );
  new AgentStore(control).enrollOperator(spec, owner, "editor");
  const traces = path.join(repo, ".git/traces");
  importTrace(
    traces,
    path.join(engine, "examples/traces/codex.jsonl"),
    "Synthetic prototype discussion",
  );
  indexTraces(traces);
  app = createWiki({
    repo,
    origin,
    control,
    traces,
    development: true,
    write: true,
  });
  app.listen(port, "127.0.0.1");
  await once(app, "listening");
  const agentDir = path.join(repo, ".git/pi");
  fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  const home = process.env.HOME;
  const settings = JSON.parse(
    fs.readFileSync(path.join(home, ".pi/agent/settings.json"), "utf8"),
  );
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      defaultThinkingLevel: settings.defaultThinkingLevel,
    }),
  );
  fs.symlinkSync(
    path.join(home, ".pi/agent/auth.json"),
    path.join(agentDir, "auth.json"),
  );
  fs.writeFileSync(
    path.join(agentDir, "extensions/wiki.ts"),
    `import wiki from ${JSON.stringify(path.join(engine, "scripts/pi-extension.mjs"))};
export default pi => wiki(pi, ${JSON.stringify({ command: process.execPath, args: [path.join(engine, "scripts/agent-mcp.mjs"), config] })});`,
  );
  const prompt =
    'Synthetic integration test: use wiki tools to search for Guide and read it. Search conversation traces for prototype and read a matching trace. Create article id pi-proof, title Pi proof, description Synthetic integration result, topic Examples, body exactly "Pi MCP write verified.", summary "Synthetic Pi acceptance", expected_revision_id null. Use a unique operation_id and required save schema. Read the saved article back. Report the results.';
  child = spawn(
    "pi",
    [
      "-p",
      prompt,
      "--mode",
      "json",
      "--no-session",
      "--no-builtin-tools",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-themes",
    ],
    {
      cwd: repo,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
    },
  );
  child.stdin.end();
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  timer = setTimeout(() => child.kill("SIGTERM"), 180000);
  const [code] = await once(child, "exit");
  clearTimeout(timer);
  const messages = output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const calls = messages.filter(
    (message) => message.type === "tool_execution_start",
  );
  assert.equal(code, 0, "Pi process failed");
  assert.ok(
    !messages.some(
      (message) => message.type === "tool_execution_end" && message.isError,
    ),
    "A Wiki tool failed",
  );
  for (const name of [
    "wiki_search",
    "wiki_read",
    "wiki_traceSearch",
    "wiki_trace",
    "wiki_save",
  ])
    assert.ok(
      calls.some((call) => call.toolName === name),
      `Missing tool: ${name}`,
    );
  assert.ok(
    calls.some(
      (call) => call.toolName === "wiki_read" && call.args.id === "pi-proof",
    ),
    "Missing read-back",
  );
  assert.equal(
    matter(
      fs.readFileSync(path.join(repo, "wiki/pi-proof.md"), "utf8"),
    ).content.trimEnd(),
    "Pi MCP write verified.",
    "Saved content differs",
  );
  const runs = control.db
    .prepare("SELECT active FROM agent_runs WHERE agent=?")
    .all(spec.agent);
  assert.equal(runs.length, 1, "Expected one adapter run");
  assert.ok(
    runs.every((run) => !run.active),
    "Run was not closed",
  );
  console.log(
    JSON.stringify(
      {
        verified: true,
        tools: calls.map((call) => call.toolName),
        savedArticle: "pi-proof",
        runClosed: true,
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
  if (app)
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
  control?.close();
  for (const close of cleanup) close();
}
