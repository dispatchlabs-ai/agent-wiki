#!/usr/bin/env node
// Explicit, optional model-driven acceptance against disposable synthetic content.
import assert from "node:assert/strict";
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
    "Usage: node scripts/verify-claude.mjs --run\nRequires an authenticated Claude Code CLI. Uses its configured model/account and consumes model usage. Creates only temporary synthetic wiki content; never connects to your real wiki.",
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
      "Synthetic Claude",
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
  const mcp = path.join(repo, ".git/mcp.json");
  fs.writeFileSync(
    mcp,
    JSON.stringify({
      mcpServers: {
        wiki: {
          type: "stdio",
          command: process.execPath,
          args: [path.join(engine, "scripts/agent-mcp.mjs"), config],
        },
      },
    }),
    { mode: 0o600 },
  );
  const prompt =
    'This is a synthetic integration test. Use only wiki MCP tools. Search for Guide and read it. Search conversation traces for prototype and read a matching trace. Then create an article with id claude-proof, title Claude proof, description Synthetic integration result, topic Examples, body exactly "Claude MCP write verified." (a trailing newline is fine), summary "Synthetic Claude acceptance", and expected_revision_id null. Use wiki.save with a unique operation_id and the required schema. Read the saved article back. Report whether each step succeeded. Do not call built-in tools or access files.';
  child = spawn(
    "claude",
    [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      mcp,
      "--tools",
      "",
      "--allowedTools",
      "mcp__wiki__*",
      "--disable-slash-commands",
    ],
    {
      cwd: repo,
      env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
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
  const blocks = messages.flatMap((message) => message.message?.content || []);
  const calls = blocks.filter((block) => block.type === "tool_use");
  const result = messages.findLast((message) => message.type === "result");
  assert.equal(code, 0, "Claude process failed");
  assert.equal(result?.is_error, false, "Claude did not complete successfully");
  assert.equal(
    result.permission_denials?.length || 0,
    0,
    "A requested tool was denied",
  );
  for (const name of [
    "mcp__wiki__wiki_search",
    "mcp__wiki__wiki_read",
    "mcp__wiki__wiki_traceSearch",
    "mcp__wiki__wiki_trace",
    "mcp__wiki__wiki_save",
  ]) {
    assert.ok(
      calls.some((call) => call.name === name),
      `Missing tool: ${name}`,
    );
  }
  assert.ok(
    calls.every((call) => call.name.startsWith("mcp__wiki__")),
    "A non-wiki tool was called",
  );
  assert.ok(
    !blocks.some((block) => block.type === "tool_result" && block.is_error),
    "A wiki tool returned an error",
  );
  assert.ok(
    calls.some(
      (call) =>
        call.name === "mcp__wiki__wiki_read" &&
        call.input.id === "claude-proof",
    ),
    "Missing article read-back",
  );
  assert.ok(
    fs
      .readFileSync(path.join(repo, "wiki/claude-proof.md"), "utf8")
      .endsWith("Claude MCP write verified.\n"),
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
        tools: calls.map((call) => call.name),
        savedArticle: "claude-proof",
        runClosed: true,
        modelSummary: result.result,
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
