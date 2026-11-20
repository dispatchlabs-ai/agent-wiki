import net from "node:net";
import { once } from "node:events";
import { createWiki } from "../../src/server.mjs";
import { ControlStore } from "../../src/control-store.mjs";
import { WikiError } from "../../src/errors.mjs";

process.once("disconnect", () => process.exit(0));

// Bind before constructing the wiki so OAuth has the actual loopback origin.
// Pass the listening socket to the HTTP server rather than racing for a port.
const listener = net.createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const origin = `http://127.0.0.1:${listener.address().port}`;
const control = new ControlStore(process.argv[3]);
const server = createWiki({
  repo: process.argv[2],
  control,
  origin,
  database: `${process.argv[3]}.index.sqlite3`,
  conversations: true,
  traces: null,
  traceIndexRoot: null,
  evidenceUrl: null,
  articleMediaRoot: null,
  trustedProxy: null,
  defaultOAuthAgent: null,
  write: true,
  push: false,
  // Only the slow backend is controlled; the wiki, auth, MCP transports,
  // loopback API bridge, Git writer, and article reader are the real ones.
  traceSearchPool: {
    search(_root, query, _options, signal) {
      if (!query.startsWith("blocked-")) return { results: [] };
      return new Promise((resolve, reject) => {
        const onMessage = (message) => {
          if (message.release !== query) return;
          cleanup();
          resolve({ results: [] });
        };
        const cleanup = () => {
          process.off("message", onMessage);
          signal.removeEventListener("abort", abort);
        };
        const abort = () => {
          cleanup();
          process.send({ event: "cancelled", query });
          reject(new WikiError("SEARCH_CANCELLED", "Search cancelled", 499));
        };
        process.on("message", onMessage);
        signal.addEventListener("abort", abort, { once: true });
        process.send({ event: "started", query });
        if (signal.aborted) abort();
      });
    },
    async close() {},
  },
});
server.listen(listener, () => process.send({ event: "ready", origin }));
