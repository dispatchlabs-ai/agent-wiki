import { WikiError } from "./errors.mjs";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { git } from "./git-wiki.mjs";

// Atomic mkdir works on local Linux and macOS filesystems. Never steal a lock
// based on age or PID: a paused writer can still resume and mutate the repository.
export async function withWriterLock(repo, action, { timeout = 10000 } = {}) {
  const lock = path.join(
    git(repo, ["rev-parse", "--absolute-git-dir"]),
    "wiki-write.lock.d",
  );
  const deadline = performance.now() + timeout;
  for (;;) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (performance.now() >= deadline)
        throw new WikiError(
          "WRITER_BUSY",
          `Writer lock timeout: ${lock}. If a writer crashed, stop all writers, inspect the repository, then remove this lock directory. See docs/api.md.`,
          503,
        );
      await delay(Math.min(50, Math.max(1, deadline - performance.now())));
    }
  }
  try {
    fs.writeFileSync(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
      { flag: "wx", mode: 0o600 },
    );
    return await action();
  } finally {
    fs.rmSync(lock, { recursive: true });
  }
}
