import { parentPort, workerData } from "node:worker_threads";
import { renderMarkdown } from "./render.mjs";

// Parsing, sanitization and output-size accounting all stay off the HTTP thread.
try {
  const html = await renderMarkdown(workerData.body);
  if (Buffer.byteLength(html) > workerData.maxBytes)
    parentPort.postMessage({ code: "PREVIEW_TOO_LARGE" });
  else parentPort.postMessage({ html });
} catch {
  parentPort.postMessage({ code: "PREVIEW_FAILED" });
}
