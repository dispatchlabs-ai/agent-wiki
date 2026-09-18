import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import {
  McpApiClient,
  McpResourceResult,
  MCP_INLINE_BYTES,
} from "../src/mcp-response.mjs";

async function bridge(t, handler, options) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new McpApiClient(server, "https://wiki.test", options);
  t.after(async () => {
    client.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return client;
}

test("large known-length MCP reads become resources without waiting for the body", async (t) => {
  let disconnected;
  const closed = new Promise((resolve) => {
    disconnected = resolve;
  });
  const client = await bridge(t, (req, res) => {
    assert.equal(req.headers.host, "wiki.test");
    res.on("close", disconnected);
    res.writeHead(200, { "Content-Length": MCP_INLINE_BYTES + 1 });
    res.flushHeaders(); // Deliberately never send the body.
  });
  const result = await client.request(
    "/api/traces/example/lines.json?start=1&end=99",
  );
  assert.ok(result instanceof McpResourceResult);
  assert.equal(
    result.uri,
    "https://wiki.test/api/traces/example/lines.json?start=1&end=99",
  );
  await closed;
  assert.equal(client.pending.size, 0);
});

test("chunked responses enforce the inline byte budget and small responses remain JSON", async (t) => {
  let sent = 0;
  let disconnected;
  const closed = new Promise((resolve) => {
    disconnected = resolve;
  });
  const client = await bridge(t, (req, res) => {
    if (req.url === "/api/small") return res.end('{"text":"ok"}');
    res.writeHead(200);
    const timer = setInterval(() => {
      sent += 65536;
      res.write(Buffer.alloc(65536, 120));
    }, 1);
    res.on("close", () => {
      clearInterval(timer);
      disconnected();
    });
  });
  assert.deepEqual(await client.request("/api/small"), { text: "ok" });
  assert.ok((await client.request("/api/large")) instanceof McpResourceResult);
  await closed;
  assert.ok(sent >= MCP_INLINE_BYTES);
  assert.ok(sent < 2 * MCP_INLINE_BYTES, `upstream transferred ${sent} bytes`);
});

test("oversized errors and writes never become successful resource links", async (t) => {
  const client = await bridge(t, (req, res) => {
    res.writeHead(req.url === "/api/error" ? 500 : 200, {
      "Content-Length": MCP_INLINE_BYTES + 1,
    });
    res.flushHeaders();
  });
  for (const [route, draft] of [
    ["/api/error", undefined],
    ["/api/write", { operation_id: "retry-same" }],
  ])
    await assert.rejects(client.request(route, draft), {
      code: "MCP_RESPONSE_TOO_LARGE",
      status: 503,
    });
});

test("MCP bridge preserves deadlines and shutdown", async (t) => {
  const client = await bridge(
    t,
    (req, res) => {
      if (req.url === "/api/ok") res.end('{"ok":true}');
    },
    { timeout: 100 },
  );
  const slow = assert.rejects(client.request("/api/hang"), {
    code: "MCP_TIMEOUT",
    status: 503,
  });
  assert.deepEqual(await client.request("/api/ok"), { ok: true });
  await slow;
  assert.deepEqual(await client.request("/api/ok"), { ok: true });
  const pending = assert.rejects(client.request("/api/hang"), {
    code: "MCP_CLOSED",
    status: 503,
  });
  client.close();
  await pending;
  await assert.rejects(client.request("/api/ok"), {
    code: "MCP_CLOSED",
    status: 503,
  });
});

test(
  "cancellation removes pending requests without cancelling other calls",
  { timeout: 5000 },
  async (t) => {
    const responses = new Map();
    const client = await bridge(t, (req, res) => {
      responses.set(req.url, res);
    });
    const first = new AbortController();
    const cancelled = assert.rejects(
      client.request("/api/first", undefined, first.signal),
      { code: "MCP_CANCELLED" },
    );
    const survivor = client.request("/api/survivor");
    while (responses.size < 2)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const closed = once(responses.get("/api/first"), "close");
    first.abort();
    await cancelled;
    await closed;
    assert.equal(client.pending.size, 1);
    const replacement = client.request("/api/replacement");
    while (!responses.has("/api/replacement"))
      await new Promise((resolve) => setTimeout(resolve, 5));
    responses.get("/api/replacement").end('{"replacement":true}');
    responses.get("/api/survivor").end('{"survivor":true}');
    assert.deepEqual(await replacement, { replacement: true });
    assert.deepEqual(await survivor, { survivor: true });
    await assert.rejects(
      client.request("/api/not-started", undefined, first.signal),
      { code: "MCP_CANCELLED" },
    );
    assert.equal(responses.size, 3);
    assert.equal(client.pending.size, 0);
  },
);

test(
  "MCP bridge admits more than four simultaneous requests",
  { timeout: 5000 },
  async (t) => {
    const responses = [];
    const client = await bridge(t, (req, res) => {
      responses.push(res);
      if (responses.length === 12) {
        for (const response of responses) response.end('{"ok":true}');
      }
    });
    const results = await Promise.all(
      Array.from({ length: 12 }, () => client.request("/api/read")),
    );
    assert.equal(responses.length, 12);
    assert.deepEqual(
      results,
      Array.from({ length: 12 }, () => ({ ok: true })),
    );
    assert.equal(client.pending.size, 0);
  },
);

test("default bridge has no deadline while explicit deadlines remain optional", async (t) => {
  const client = await bridge(t, (req, res) => {
    setTimeout(() => res.end('{"ok":true}'), 25);
  });
  assert.equal(client.timeout, 0);
  assert.deepEqual(await client.request("/api/slow"), { ok: true });
});
