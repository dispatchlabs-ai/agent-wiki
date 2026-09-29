import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";

const probe = (port, extra = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("python3", ["scripts/healthcheck.py"], {
      env: { ...process.env, PORT: String(port), ...extra },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });

test("container probe checks HTTP liveness on the configured local port", async () => {
  let status = 200;
  const paths = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url);
    response.writeHead(status);
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    assert.equal(await probe(port, { http_proxy: "http://127.0.0.1:1" }), 0);
    status = 503;
    assert.equal(await probe(port), 1);
    assert.deepEqual(paths, ["/healthz", "/healthz"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await probe(port), 1);
  assert.equal(await probe("invalid"), 1);
  assert.equal(await probe(65536), 1);
});
