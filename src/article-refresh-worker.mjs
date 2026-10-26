import { parentPort, workerData } from "node:worker_threads";
import { GitWiki } from "./git-wiki.mjs";
import { WikiSearch } from "./wiki-search.mjs";

const wiki = Object.assign(
  Object.create(GitWiki.prototype),
  workerData.snapshot,
);
const index = new WikiSearch(workerData.database);
parentPort.on("message", async ({ kind, key, head, id, refs }) => {
  const reply = (result) => parentPort.postMessage({ key, result });
  if (kind === "history") {
    try {
      reply({ revisions: await wiki.history(id, refs) });
    } catch (error) {
      reply({ error: error.message });
    }
    return;
  }
  const previous = { ...wiki };
  let stage = "storage";
  try {
    if (kind === "checkpoint") {
      stage = "index";
      reply({
        checkpoint: index.db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get(),
      });
      return;
    }
    const changed = wiki.refresh();
    stage = "index";
    const stats = index.sync(wiki);
    // Each side owns immutable, allowlisted attribution projections. Refresh
    // replaces the article/index snapshot, never either side's history cache.
    const { attributions, ...snapshot } = wiki;
    reply({
      snapshot: changed || wiki.head !== head ? snapshot : null,
      stats,
    });
  } catch (error) {
    Object.assign(wiki, previous);
    reply({ error: error.message, stage });
  }
});
