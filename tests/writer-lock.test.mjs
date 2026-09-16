import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fixture } from "./helpers.mjs";
import { withWriterLock } from "../src/writer-lock.mjs";

const moduleURL = new URL("../src/writer-lock.mjs", import.meta.url).href;

test("a live writer excludes contenders and releases after failure", async (t) => {
  const repo = fixture(t);
  await assert.rejects(
    withWriterLock(repo, async () => {
      await assert.rejects(
        withWriterLock(repo, () => assert.fail("entered"), { timeout: 60 }),
        /Writer lock timeout/,
      );
      throw Error("failed operation");
    }),
    /failed operation/,
  );
  assert.equal(await withWriterLock(repo, () => "released"), "released");
});

test("a killed writer leaves a fail-closed lock until offline recovery", async (t) => {
  const repo = fixture(t);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { withWriterLock } from ${JSON.stringify(moduleURL)};
    await withWriterLock(process.argv[1], async () => {
      process.stdout.write("locked");
      await new Promise(() => { setInterval(() => {}, 1000); });
    });
  `,
      repo,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => child.kill("SIGKILL"));
  await once(child.stdout, "data");
  const closed = once(child, "close");
  child.kill("SIGKILL");
  await closed;
  await assert.rejects(
    withWriterLock(repo, () => assert.fail("stolen"), { timeout: 60 }),
    /Writer lock timeout/,
  );
  fs.rmSync(path.join(repo, ".git/wiki-write.lock.d"), { recursive: true });
  assert.equal(await withWriterLock(repo, () => "recovered"), "recovered");
});
