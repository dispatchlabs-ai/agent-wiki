import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.mjs";

// Exercise the documented operator commands and production entry point. The
// Host/Origin headers model an operator's HTTPS reverse proxy, not TLS issuance.
test(
  "documented hosting bootstrap starts the real server and preserves account access",
  { timeout: 30000 },
  async (t) => {
    const repo = fixture(t);
    const state = path.join(repo, ".git", "auth");
    fs.mkdirSync(state, { mode: 0o700 });
    const source = fileURLToPath(new URL("..", import.meta.url));
    const reservation = http.createServer().listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const origin = "https://wiki.example.test";
    const env = { ...process.env };
    for (const name of Object.keys(env))
      if (name.startsWith("WIKI_")) delete env[name];
    Object.assign(env, {
      WIKI_CONTROL: path.join(state, "control.sqlite3"),
      WIKI_REPO: repo,
      WIKI_ORIGIN: origin,
      PORT: String(port),
      WIKI_LOCAL_LOGIN: "1",
      WIKI_WRITE: "0",
      WIKI_PUSH: "0",
      WIKI_DATABASE: ":memory:",
      WIKI_TRACES: "",
      WIKI_EVIDENCE_URL: "",
    });
    const setup = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "scripts/local-account.mjs",
          "bootstrap",
          "manager@example.org",
          "Initial manager",
        ],
        { cwd: source, env, encoding: "utf8" },
      ),
    );
    assert.equal(new URL(setup.setup_url).origin, origin);
    let child;
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = once(child, "close");
        child.kill();
        await closed;
      }
    }
    t.after(stop);
    async function start() {
      child = spawn(process.execPath, ["src/server.mjs"], {
        cwd: source,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Server startup timed out")),
          10000,
        );
        child.once("error", reject);
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(Error(`Server exited ${code}`));
        });
        child.stdout.on("data", (data) => {
          if (data.toString().includes("Wiki:")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }
    let cookie = "";
    async function request(route, body, csrf) {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${port}${route}`,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              Host: "wiki.example.test",
              ...(cookie ? { Cookie: cookie } : {}),
              ...(body === undefined
                ? {}
                : {
                    Origin: origin,
                    "Content-Type": "application/json",
                    "X-Wiki-CSRF": csrf,
                  }),
            },
          },
          (response) => {
            response.resume();
            response.once("end", () =>
              resolve({
                status: response.statusCode,
                cookies: response.headers["set-cookie"] || [],
              }),
            );
          },
        );
        req.once("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
      for (const value of res.cookies) {
        const pair = value.split(";")[0];
        const name = pair.split("=")[0];
        cookie = [
          ...cookie.split("; ").filter((s) => s && !s.startsWith(name + "=")),
          pair,
        ].join("; ");
      }
      return res;
    }
    await start();
    assert.equal((await request("/api/articles/catalog.json")).status, 401);
    await request("/auth/local/setup");
    const form = cookie
      .split("; ")
      .find((s) => s.startsWith("wiki_form="))
      .slice(10);
    const result = await request(
      "/auth/local/setup",
      {
        token: new URL(setup.setup_url).hash.slice(1),
        password: "synthetic-long-test-password",
      },
      form,
    );
    assert.equal(result.status, 200);
    assert.equal((await request("/api/me")).status, 200);
    assert.equal((await request("/wiki/guide/")).status, 200);
    assert.equal(
      (await request("/api/articles/guide/current.json")).status,
      200,
    );
    await stop();
    await start();
    assert.equal((await request("/api/me")).status, 200);
    assert.equal((await request("/wiki/guide/")).status, 200);
  },
);
