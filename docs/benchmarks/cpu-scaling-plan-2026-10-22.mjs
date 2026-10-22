import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
const targets = JSON.parse(process.env.CPU_BENCH_TARGETS);
const levels =
  process.env.CPU_BENCH_SMOKE === "1"
    ? [[1, 0]]
    : [
        [1, 0],
        [4, 1],
        [12, 2],
        [24, 4],
        [48, 8],
        [96, 16],
      ];
const seconds = process.env.CPU_BENCH_SMOKE === "1" ? 3 : 45;
const repeats = process.env.CPU_BENCH_SMOKE === "1" ? 1 : 2;
console.log(
  JSON.stringify({
    event: "plan",
    node: process.version,
    source: process.env.CPU_BENCH_SOURCE,
    levels,
    seconds,
    repeats,
    driverSha256: createHash("sha256")
      .update(fs.readFileSync("scripts/cpu-scaling.mjs"))
      .digest("hex"),
    serverMemoryMiB: 4096,
    clientVcpu: 2,
    clientMemoryMiB: 4096,
  }),
);
let completed = 0;
for (let repeat = 0; repeat < repeats; repeat++) {
  const orderedLevels = repeat === 0 ? levels : [...levels].reverse();
  const orderedTargets = repeat === 0 ? targets : [...targets].reverse();
  for (const [readers, writers] of orderedLevels) {
    for (const target of orderedTargets) {
      const id = `${repeat}-${target.vcpu}-${readers}-${writers}`;
      console.log(
        JSON.stringify({
          event: "run-start",
          id,
          vcpu: target.vcpu,
          readers,
          writers,
          repeat,
        }),
      );
      const child = spawn(process.execPath, ["scripts/cpu-scaling.mjs"], {
        env: {
          ...process.env,
          CPU_BENCH_REMOTE: target.url,
          BENCH_READERS: String(readers),
          BENCH_WRITERS: String(writers),
          BENCH_ARTICLES: process.env.CPU_BENCH_SMOKE === "1" ? "1000" : "1000",
          BENCH_BODY_BYTES:
            process.env.CPU_BENCH_SMOKE === "1" ? "4096" : "4096",
          BENCH_SECONDS: String(seconds),
          BENCH_TIMEOUT_MS: "120000",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const out = [],
        err = [];
      child.stdout.on("data", (b) => out.push(b));
      child.stderr.on("data", (b) => err.push(b));
      const deadline = setTimeout(() => child.kill("SIGTERM"), 300000);
      const [exitCode, signal] = await once(child, "exit");
      clearTimeout(deadline);
      const stdout = Buffer.concat(out).toString();
      const stderr = Buffer.concat(err).toString();
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        console.log(
          JSON.stringify({
            event: "run-failed",
            id,
            exitCode,
            signal,
            stderr: stderr.slice(-20000),
            stdout: stdout.slice(-1000),
          }),
        );
        throw Error(`No result for ${id}`);
      }
      console.log(
        JSON.stringify({
          event: "run-result",
          id,
          vcpu: target.vcpu,
          repeat,
          exitCode,
          signal,
          result,
        }),
      );
      completed++;
    }
  }
}
console.log(JSON.stringify({ event: "plan-complete", completed }));
