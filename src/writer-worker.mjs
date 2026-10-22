import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { GitEditor } from "./editor.mjs";
import { WikiError } from "./errors.mjs";

const editor = new GitEditor(workerData.repo, workerData.options);
// The controller sends only one save at a time, including across async evidence
// checks. Synchronous Git and SQLite work stays off the HTTP event loop.
parentPort.on("message", async ({ kind, draft, credentials, deadline }) => {
  if (kind === "close") {
    editor.close();
    parentPort.close();
    return;
  }
  try {
    const timeout = deadline - (performance.timeOrigin + performance.now());
    if (timeout <= 0)
      throw new WikiError(
        "WRITER_BUSY",
        "Writer queue timeout; retry the identical operation",
        503,
      );
    const receipt = await editor.save(draft, credentials, { timeout });
    parentPort.postMessage({ receipt });
  } catch (error) {
    parentPort.postMessage({
      error: {
        code: error instanceof WikiError ? error.code : "WRITER_UNAVAILABLE",
        message: error.message,
        status: error instanceof WikiError ? error.status : 503,
      },
    });
  }
});
