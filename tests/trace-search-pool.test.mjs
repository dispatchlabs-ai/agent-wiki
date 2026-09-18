import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { EventEmitter } from "node:events";
import { TraceSearchPool } from "../src/trace-search-pool.mjs";

const childUrl = new URL("./fixtures/trace-search-child.mjs", import.meta.url);
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("Timed out waiting for trace-search process state");
}

test("trace searches are bounded and cancellation kills native work before reusing its slot", async (t) => {
  const pool = new TraceSearchPool({ workers: 1, queue: 1, childUrl });
  t.after(() => pool.close());
  const running = new AbortController();
  const queued = new AbortController();
  const first = pool.search("unused", "hang", {}, running.signal);
  await until(() => pool.children.size === 1);
  const second = pool.search("unused", "queued", {}, queued.signal);
  await assert.rejects(
    pool.search("unused", "busy", {}),
    (error) => error.code === "SEARCH_BUSY",
  );
  queued.abort();
  await assert.rejects(second, (error) => error.code === "SEARCH_CANCELLED");
  running.abort();
  await assert.rejects(first, (error) => error.code === "SEARCH_CANCELLED");
  await until(() => pool.children.size === 0);
  assert.equal((await pool.search("unused", "recovered", {})).indexed, true);
});

test("closing the pool kills active search processes and settles their callers", async () => {
  const pool = new TraceSearchPool({ workers: 1, childUrl });
  const pending = pool.search("unused", "hang", {});
  await until(() => pool.children.size === 1);
  const rejected = assert.rejects(
    pending,
    (error) => error.code === "SEARCH_CLOSED",
  );
  await pool.close();
  await rejected;
  assert.equal(pool.children.size, 0);
});

test("a spawn error releases its slot on close and does not hang shutdown", async () => {
  let attempts = 0;
  const forkProcess = () => {
    attempts++;
    const child = new EventEmitter();
    child.kill = () => true;
    child.send = () => {};
    process.nextTick(() => {
      child.emit("error", Error("Synthetic EAGAIN"));
      child.emit("close", -1, null);
    });
    return child;
  };
  const pool = new TraceSearchPool({ workers: 1, forkProcess });
  await assert.rejects(
    pool.search("unused", "first", {}),
    (error) => error.code === "SEARCH_UNAVAILABLE",
  );
  await until(() => pool.children.size === 0);
  await assert.rejects(
    pool.search("unused", "second", {}),
    (error) => error.code === "SEARCH_UNAVAILABLE",
  );
  assert.equal(attempts, 2, "the failed spawn must not retain the only slot");
  await pool.close();
});
