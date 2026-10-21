import { parentPort, workerData } from "node:worker_threads";
import { GitWiki } from "./git-wiki.mjs";
import { WikiSearch } from "./wiki-search.mjs";

const wiki = Object.assign(
  Object.create(GitWiki.prototype),
  workerData.snapshot,
);
const index = new WikiSearch(workerData.database);
parentPort.on("message", ({ kind, head }) => {
  const previous = { ...wiki };
  let stage = "storage";
  try {
    if (kind === "checkpoint") {
      stage = "index";
      parentPort.postMessage({
        checkpoint: index.db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get(),
      });
      return;
    }
    const changed = wiki.refresh();
    stage = "index";
    const stats = index.sync(wiki);
    parentPort.postMessage({
      snapshot: changed || wiki.head !== head ? { ...wiki } : null,
      stats,
    });
  } catch (error) {
    Object.assign(wiki, previous);
    parentPort.postMessage({ error: error.message, stage });
  }
});
