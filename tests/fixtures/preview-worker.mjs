import { parentPort, workerData } from "node:worker_threads";

// Deterministic CPU stall/crash fixtures for worker lifecycle tests.
if (workerData.body === "hang")
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
if (workerData.body === "throw") throw Error("Synthetic renderer failure");
if (workerData.body === "exit") process.exit(1);
parentPort.postMessage({ html: workerData.body });
