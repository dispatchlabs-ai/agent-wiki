import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { git } from "../src/git-wiki.mjs";
import { fixture } from "./helpers.mjs";

test(
  "example startup isolates ambient providers and preserves edits on restart",
  { timeout: 30000 },
  async (t) => {
    const sentinel = fixture(t);
    const sentinelHead = git(sentinel, ["rev-parse", "HEAD"]);
    let providerRequests = 0;
    const provider = http
      .createServer((req, res) => {
        providerRequests++;
        res.writeHead(500).end();
      })
      .listen(0, "127.0.0.1");
    await once(provider, "listening");
    t.after(() => new Promise((resolve) => provider.close(resolve)));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-example-test-"));
    const stops = [];
    t.after(async () => {
      for (const stop of stops.reverse()) await stop();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const source = fileURLToPath(new URL("../", import.meta.url));
    for (const name of [
      "src",
      "ui",
      "public",
      "scripts",
      "examples",
      "package.json",
    ])
      fs.cpSync(path.join(source, name), path.join(root, name), {
        recursive: true,
      });
    fs.symlinkSync(
      path.join(source, "node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    const corpus = fs.readFileSync(
      path.join(root, "examples/wiki/atlas-labs.md"),
      "utf8",
    );
    const runtimeRepo = path.join(root, ".runtime/example");
    const reservation = http.createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    async function start() {
      const child = spawn(process.execPath, ["scripts/example.mjs"], {
        cwd: root,
        env: {
          ...process.env,
          PORT: String(port),
          WIKI_ORIGIN: origin,
          WIKI_DATABASE: path.join(root, ".runtime/example.sqlite3"),
          WIKI_REPO: sentinel,
          WIKI_TRACES: sentinel,
          WIKI_EVIDENCE_URL: `http://127.0.0.1:${provider.address().port}`,
          WIKI_PUSH: "1",
          WIKI_WRITE: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = once(child, "close");
      const stop = async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await closed;
      };
      stops.push(stop);
      let output = "";
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error(`Example startup timed out: ${output}`)),
          10000,
        );
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          reject(Error(`Example exited ${code}: ${output}`));
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("Example wiki:")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      return stop;
    }
    const stop = await start();
    const currentUrl = `${origin}/api/articles/atlas-labs/current.json`;
    const current = await (await fetch(currentUrl)).json();
    assert.equal(current.title, "Atlas Labs");
    const response = await fetch(`${origin}/api/articles/edits`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Wiki-Write": "1",
      },
      body: JSON.stringify({
        operation_id: "example-isolation",
        updates: [
          {
            id: "atlas-labs",
            expected_revision_id: current.revision_id,
            title: current.title,
            description: current.description,
            topic: current.topic,
            body: current.body + "\nA synthetic tutorial note.\n",
            summary: "Test example isolation",
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.equal(receipt.state, "saved");
    assert.equal(receipt.remote, "not-requested");
    await stop();
    const savedHead = git(runtimeRepo, ["rev-parse", "HEAD"]);
    await start();
    assert.match(
      (await (await fetch(currentUrl)).json()).body,
      /A synthetic tutorial note/,
    );
    assert.equal(git(runtimeRepo, ["rev-parse", "HEAD"]), savedHead);
    assert.equal(
      fs.readFileSync(path.join(root, "examples/wiki/atlas-labs.md"), "utf8"),
      corpus,
    );
    assert.equal(git(sentinel, ["rev-parse", "HEAD"]), sentinelHead);
    assert.equal(git(sentinel, ["status", "--porcelain"]), "");
    assert.equal(providerRequests, 0);
  },
);
