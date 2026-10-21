import { parentPort, workerData } from "node:worker_threads";
import { renderMarkdown } from "./render.mjs";

// Parsing, sanitization and output-size accounting all stay off the HTTP thread.
parentPort.on("message", async ({ body }) => {
  try {
    const html = await renderMarkdown(body);
    if (Buffer.byteLength(html) > workerData.maxBytes)
      parentPort.postMessage({ code: "PREVIEW_TOO_LARGE" });
    else parentPort.postMessage({ html });
  } catch {
    parentPort.postMessage({ code: "PREVIEW_FAILED" });
  }
});
